const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Consumer = require("../model/Shop/Consumer");
const PendingRegistration = require("../model/Shop/PendingRegistration");
const PasswordReset = require("../model/Shop/PasswordReset");
const { sendMail, smtpConfigured } = require("./mailerService");
const {
  sendSMS,
  isConfigured: smsConfigured,
  otpMessageText,
} = require("./smsService");
const {
  buildLocationAccess,
  applyLocationAccess,
  publicLocationAccess,
} = require("./locationAccessService");
const { reverseGeocode } = require("./reverseGeocodeService");

/**
 * Storefront (customer-shop) auth: register / login with email OR phone +
 * password, plus optional email-OTP verification or SMS-OTP verification
 * via the shared mailerService / smsService.
 *
 * PHONE IS THE PRIMARY IDENTIFIER FOR SMS OTP.
 * EMAIL is optional and used only for email verification (legacy).
 *
 * 👤 PROFILE (additive): updateProfile() and changePassword() back the
 * self-service account hub at /customer-shop/profile. Both are scoped by the
 * consumerId taken from the JWT, so a shopper can only ever touch their OWN
 * document.
 */

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

// Resend throttling for the OTP-first registration flow below. Without these,
// the "resend" button is a free way to burn SMS credits.
const RESEND_COOLDOWN_MS = 60 * 1000; // दो code के बीच कम से कम 60 सेकंड
const MAX_RESENDS = 5; // एक pending registration पर ज़्यादा से ज़्यादा 5 बार

// The SAME shapes validators/customerValidators.js uses, so a phone or email
// that is accepted here is accepted everywhere else in the system too.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Consumer principal token (kept separate from company/seller tokens). */
function signConsumerToken(consumer) {
  return jwt.sign(
    { id: consumer._id, principalType: "consumer" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );
}

/** Strip secrets before returning a consumer to the client. */
function publicConsumer(c) {
  return {
    _id: c._id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    emailVerified: c.emailVerified,
    phoneVerified: c.phoneVerified,
    addresses: c.addresses || [],
    // Live-location consent, so the storefront knows whether it still has to
    // ask. Carried on register / login / me alike, which is what lets the
    // prompt decide straight from ShopAuthContext with no extra request.
    locationAccess: publicLocationAccess(c.locationAccess),
  };
}

/** "9898765432" → "******5432". Shopper पहचान ले, पर पूरा number न दिखे. */
function maskPhone(phone) {
  const p = String(phone || "");
  return p.length <= 4 ? p : "*".repeat(p.length - 4) + p.slice(-4);
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

/** Generate + email a 6-digit OTP. Returns whether it was actually delivered. */
async function issueEmailOtp(consumer) {
  if (!consumer.email) return { delivered: false, reason: "no-email" };
  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  consumer.emailOtp = {
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  };
  await consumer.save();

  const result = await sendMail({
    to: consumer.email,
    subject: "Your Khetify verification code",
    text: `Your Khetify verification code is ${code}. It is valid for 10 minutes.`,
    html: `<div style="font-family:Arial,sans-serif">
        <h2 style="color:#EA2831">Khetify</h2>
        <p>Your verification code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
        <p style="color:#666;font-size:13px">Valid for 10 minutes. If you didn't request this, ignore this email.</p>
      </div>`,
  });
  // In dev (no SMTP), the code is logged by mailerService. Surface that so the
  // frontend can hint the tester to check the server console.
  return { delivered: result.delivered, smtp: smtpConfigured() };
}

/** Generate + send SMS a 6-digit OTP. Returns whether it was actually delivered. */
async function issueSmsOtp(consumer) {
  if (!consumer.phone) return { delivered: false, reason: "no-phone" };

  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  consumer.phoneOtp = {
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  };
  await consumer.save();

  try {
    // Text smsService का है, यहाँ का नहीं — DLT template से hubahu match होना
    // ज़रूरी है और वो एक ही जगह रहना चाहिए.
    const result = await sendSMS({
      number: consumer.phone, // 10-digit format (9898765432)
      text: otpMessageText(code),
    });
    return { delivered: result.delivered, jobId: result.jobId };
  } catch (error) {
    console.error("SMS sending failed:", error.message);
    // SMS is best-effort; account still created
    return { delivered: false, error: error.message };
  }
}

/**
 * Register a new shopper. Duplicate email/phone → 409.
 *
 * PHONE IS THE REQUIRED IDENTIFIER; EMAIL IS OPTIONAL. Every shopper therefore
 * has one guaranteed way to log in (login() already accepts either), while the
 * email — and with it the OTP step below — is opt-in. Spaces and hyphens are
 * stripped before the check so "98765 43210" is accepted as typed.
 *
 * NEW: SMS OTP is triggered when phone is provided (no email needed).
 * EMAIL OTP is deprecated in favor of SMS OTP for better deliverability.
 *
 * The Consumer schema already indexes both as `unique + sparse`, so an account
 * carrying only a phone stores no email key at all and cannot collide with
 * another email-less account. No model change was needed.
 */
async function register({ name, email, phone, password }) {
  name = (name || "").trim();
  email = (email || "").trim().toLowerCase() || undefined;
  phone = (phone || "").trim().replace(/[\s-]/g, "") || undefined;
  if (!name) throw httpErr("Name is required");
  if (!phone) throw httpErr("Phone number is required");
  if (!PHONE_RE.test(phone))
    throw httpErr("Enter a valid 10-digit phone number");
  // Optional — but a supplied address must still be a real one, because it
  // becomes a login identifier and the OTP destination.
  if (email && !EMAIL_RE.test(email))
    throw httpErr("Enter a valid email address");
  if (!password || String(password).length < 6)
    throw httpErr("Password must be at least 6 characters");

  const or = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  const existing = or.length ? await Consumer.findOne({ $or: or }) : null;
  if (existing)
    throw httpErr("An account with this email or phone already exists", 409);

  const passwordHash = await bcrypt.hash(String(password), 10);
  const consumer = await Consumer.create({ name, email, phone, passwordHash });

  let otp = { delivered: false };
  // PRIMARY: SMS OTP via phone (new flow)
  if (phone) {
    try {
      otp = await issueSmsOtp(consumer);
    } catch {
      /* SMS is best-effort; account still created */
    }
  }
  // FALLBACK: Email OTP if email provided (legacy, but kept for compatibility)
  else if (email) {
    try {
      otp = await issueEmailOtp(consumer);
    } catch {
      /* email is best-effort; account still created */
    }
  }

  return {
    token: signConsumerToken(consumer),
    consumer: publicConsumer(consumer),
    otpSent: otp.delivered,
  };
}

/* ═══════════════ OTP-FIRST REGISTRATION ═══════════════
 * register() ऊपर वैसा ही है और कहीं से call हो तो वैसा ही चलेगा. यह नीचे
 * वाला रास्ता अलग है: यहाँ account तभी बनता है जब OTP verify हो जाए.
 * ═══════════════════════════════════════════════════════ */

/**
 * STEP 1 — validate + OTP भेजो. CREATES NO ACCOUNT.
 *
 * यही वो बदलाव है जो fake numbers को रोकता है: सब कुछ validate होता है और
 * password hash होकर PendingRegistration में रुक जाता है — Consumer collection
 * को छुआ तक नहीं जाता. OTP कभी verify न हुआ तो 30 मिनट बाद वो pending row
 * खुद delete हो जाती है और number दोबारा free हो जाता है.
 *
 * @returns { otpSent, phone, sms } — कोई token नहीं, कोई consumer नहीं
 */
async function sendRegistrationOtp({ name, email, phone, password }) {
  name = (name || "").trim();
  email = (email || "").trim().toLowerCase() || undefined;
  phone = (phone || "").trim().replace(/[\s-]/g, "") || undefined;

  // वही validation जो register() में है, ताकि दोनों रास्ते एक ही चीज़ मानें.
  if (!name) throw httpErr("Name is required");
  if (!phone) throw httpErr("Phone number is required");
  if (!PHONE_RE.test(phone))
    throw httpErr("Enter a valid 10-digit phone number");
  if (email && !EMAIL_RE.test(email))
    throw httpErr("Enter a valid email address");
  if (!password || String(password).length < 6)
    throw httpErr("Password must be at least 6 characters");

  // Duplicate check यहीं होना ज़रूरी है — वरना shopper पूरा OTP भरने के बाद
  // जानेगा कि उसका number पहले से registered है.
  const or = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  const existing = await Consumer.findOne({ $or: or });
  if (existing)
    throw httpErr("An account with this email or phone already exists", 409);

  const passwordHash = await bcrypt.hash(String(password), 10);
  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits

  // UPSERT — उसी number पर दोबारा try करने से पुरानी pending row overwrite हो
  // जाती है, यानी हमेशा सिर्फ़ सबसे नया code valid रहता है.
  await PendingRegistration.findOneAndUpdate(
    { phone },
    {
      name,
      email,
      phone,
      passwordHash,
      otp: {
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
      },
      lastSentAt: new Date(),
      resendCount: 0,
      createdAt: new Date(), // TTL घड़ी दोबारा शुरू
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  let delivered = false;
  try {
    const result = await sendSMS({
      number: phone,
      text: otpMessageText(code),
    });
    delivered = result.delivered;
  } catch (error) {
    // SMS fail होने पर भी pending row बनी रहती है — shopper "resend" दबा सकता है.
    console.error("[register] SMS failed:", error.message);
  }

  return { otpSent: delivered, phone, sms: smsConfigured() };
}

/**
 * STEP 2 — OTP verify करो, और तभी असली account बनाओ.
 *
 * इस रास्ते से बना हर account पहले से phone-verified है — phoneVerified: true
 * यहाँ एक अनुमान नहीं, अभी-अभी साबित हुई बात है.
 *
 * @returns { token, consumer } — register() जैसा ही shape
 */
async function verifyRegistrationOtp({ phone, code }) {
  phone = (phone || "").trim().replace(/[\s-]/g, "");
  if (!phone) throw httpErr("Phone number is required");
  if (!code) throw httpErr("Verification code is required");

  const pending = await PendingRegistration.findOne({ phone });
  if (!pending)
    throw httpErr("No pending registration found. Please start again.", 404);

  const otp = pending.otp;
  if (otp.expiresAt < new Date())
    throw httpErr("Code expired. Request a new code.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS)
    throw httpErr("Too many attempts. Request a new code.");

  if (hashOtp(code) !== otp.codeHash) {
    pending.otp.attempts = (otp.attempts || 0) + 1;
    await pending.save();
    throw httpErr("Incorrect code", 401);
  }

  // OTP सही निकला — अब जाकर असली account बनता है.
  // Race guard: OTP भरने के दौरान किसी और ने वही number ले लिया हो तो यहाँ
  // साफ़ 409 मिलेगा, raw E11000 नहीं.
  const clash = await Consumer.findOne({
    $or: [
      ...(pending.email ? [{ email: pending.email }] : []),
      { phone: pending.phone },
    ],
  });
  if (clash) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    throw httpErr("An account with this email or phone already exists", 409);
  }

  const consumer = await Consumer.create({
    name: pending.name,
    email: pending.email,
    phone: pending.phone,
    passwordHash: pending.passwordHash,
    phoneVerified: true,
  });

  await PendingRegistration.deleteOne({ _id: pending._id });

  return {
    token: signConsumerToken(consumer),
    consumer: publicConsumer(consumer),
  };
}

/**
 * STEP 1b — उसी pending registration के लिए नया OTP भेजो.
 * Throttled: 60 सेकंड cooldown और कुल 5 resend.
 */
async function resendRegistrationOtp({ phone }) {
  phone = (phone || "").trim().replace(/[\s-]/g, "");
  if (!phone) throw httpErr("Phone number is required");

  const pending = await PendingRegistration.findOne({ phone });
  if (!pending)
    throw httpErr("No pending registration found. Please start again.", 404);

  const sinceLast = Date.now() - new Date(pending.lastSentAt).getTime();
  if (sinceLast < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000);
    throw httpErr(
      `Please wait ${wait} seconds before requesting a new code`,
      429,
    );
  }
  if (pending.resendCount >= MAX_RESENDS)
    throw httpErr("Too many code requests. Please start again.", 429);

  const code = String(crypto.randomInt(100000, 1000000));
  pending.otp = {
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  };
  pending.lastSentAt = new Date();
  pending.resendCount = (pending.resendCount || 0) + 1;
  await pending.save();

  let delivered = false;
  try {
    const result = await sendSMS({
      number: phone,
      text: otpMessageText(code),
    });
    delivered = result.delivered;
  } catch (error) {
    console.error("[register] SMS resend failed:", error.message);
  }

  return { otpSent: delivered, sms: smsConfigured() };
}

/* ═══════════════ 🔑 FORGOT PASSWORD ═══════════════
 * changePassword() ऊपर वैसा ही है — वो logged-in shopper के लिए है और पुराना
 * password माँगता है. यह नीचे वाला रास्ता उनके लिए है जो password भूल चुके हैं
 * और log in ही नहीं कर सकते. दोनों एक-दूसरे को नहीं छूते.
 * ═══════════════════════════════════════════════════ */

/**
 * STEP 1 — phone पर reset code भेजो.
 *
 * Number registered न हो तो साफ़ 404 लौटता है, ताकि shopper को तुरंत पता चले
 * कि उसने गलत number डाला या उसका account किसी और number पर है.
 *
 * @returns { otpSent, phoneMasked } — masked number ताकि अगली screen
 *          "******3298" दिखा सके बिना पूरा number दोबारा माँगे.
 */
async function sendPasswordResetOtp({ phone }) {
  phone = (phone || "").trim().replace(/[\s-]/g, "");
  if (!phone) throw httpErr("Phone number is required");
  if (!PHONE_RE.test(phone))
    throw httpErr("Enter a valid 10-digit phone number");

  const consumer = await Consumer.findOne({ phone });
  if (!consumer)
    throw httpErr("No account is registered with this phone number", 404);
  if (consumer.status === "disabled") throw httpErr("Account disabled", 403);

  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits

  // UPSERT — दोबारा "forgot password" दबाने पर पुरानी row overwrite हो जाती है,
  // यानी हमेशा सिर्फ़ सबसे नया code valid रहता है.
  await PasswordReset.findOneAndUpdate(
    { phone },
    {
      consumerId: consumer._id,
      phone,
      otp: {
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
      },
      lastSentAt: new Date(),
      resendCount: 0,
      createdAt: new Date(), // TTL घड़ी दोबारा शुरू
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  let delivered = false;
  try {
    const result = await sendSMS({ number: phone, text: otpMessageText(code) });
    delivered = result.delivered;
  } catch (error) {
    // SMS fail हो तो भी row बनी रहती है — shopper "resend" दबा सकता है.
    console.error("[forgot-password] SMS failed:", error.message);
  }

  return { otpSent: delivered, phoneMasked: maskPhone(phone) };
}

/**
 * STEP 2 — code verify करो और नया password लिख दो.
 *
 * दोनों काम एक ही call में, जान-बूझकर. अगर code verify करने का अलग endpoint
 * होता तो वो "verified" अवस्था कहीं रखनी पड़ती, और वही एक और दरवाज़ा बन जाती.
 * यहाँ सही code और नया password साथ आते हैं, तभी कुछ बदलता है.
 */
async function resetPasswordWithOtp({ phone, code, newPassword }) {
  phone = (phone || "").trim().replace(/[\s-]/g, "");
  if (!phone) throw httpErr("Phone number is required");
  if (!code) throw httpErr("Verification code is required");
  if (!newPassword || String(newPassword).length < 6)
    throw httpErr("Password must be at least 6 characters");

  const pending = await PasswordReset.findOne({ phone });
  if (!pending)
    throw httpErr("No password reset in progress. Please start again.", 404);

  const otp = pending.otp;
  if (otp.expiresAt < new Date())
    throw httpErr("Code expired. Request a new code.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS)
    throw httpErr("Too many attempts. Request a new code.");

  if (hashOtp(code) !== otp.codeHash) {
    pending.otp.attempts = (otp.attempts || 0) + 1;
    await pending.save();
    throw httpErr("Incorrect code", 401);
  }

  const consumer = await Consumer.findById(pending.consumerId);
  if (!consumer) {
    await PasswordReset.deleteOne({ _id: pending._id });
    throw httpErr("Account not found", 404);
  }

  consumer.passwordHash = await bcrypt.hash(String(newPassword), 10);
  // Reset भी phone का मालिकाना साबित करता है, बिलकुल registration OTP की तरह.
  consumer.phoneVerified = true;
  await consumer.save();

  await PasswordReset.deleteOne({ _id: pending._id });

  // जान-बूझकर कोई token नहीं लौटाया जाता. shopper नया password डालकर खुद
  // log in करे — यही पक्का करता है कि नया password वाकई उसे याद है.
  return { success: true };
}

/** STEP 1b — उसी reset के लिए नया code. 60s cooldown, कुल 5 बार. */
async function resendPasswordResetOtp({ phone }) {
  phone = (phone || "").trim().replace(/[\s-]/g, "");
  if (!phone) throw httpErr("Phone number is required");

  const pending = await PasswordReset.findOne({ phone });
  if (!pending)
    throw httpErr("No password reset in progress. Please start again.", 404);

  const sinceLast = Date.now() - new Date(pending.lastSentAt).getTime();
  if (sinceLast < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000);
    throw httpErr(
      `Please wait ${wait} seconds before requesting a new code`,
      429,
    );
  }
  if (pending.resendCount >= MAX_RESENDS)
    throw httpErr("Too many code requests. Please start again.", 429);

  const code = String(crypto.randomInt(100000, 1000000));
  pending.otp = {
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  };
  pending.lastSentAt = new Date();
  pending.resendCount = (pending.resendCount || 0) + 1;
  await pending.save();

  let delivered = false;
  try {
    const result = await sendSMS({ number: phone, text: otpMessageText(code) });
    delivered = result.delivered;
  } catch (error) {
    console.error("[forgot-password] SMS resend failed:", error.message);
  }

  return { otpSent: delivered, sms: smsConfigured() };
}

/** Login with email OR phone (the `identifier`) + password. */
async function login({ identifier, password }) {
  identifier = (identifier || "").trim();
  if (!identifier || !password)
    throw httpErr("Email/phone and password are required");

  const consumer = await Consumer.findOne({
    $or: [{ email: identifier.toLowerCase() }, { phone: identifier }],
  });
  if (
    !consumer ||
    !(await bcrypt.compare(String(password), consumer.passwordHash))
  ) {
    throw httpErr("Invalid credentials", 401);
  }
  if (consumer.status === "disabled") throw httpErr("Account disabled", 403);

  consumer.lastLoginAt = new Date();
  await consumer.save();
  return {
    token: signConsumerToken(consumer),
    consumer: publicConsumer(consumer),
  };
}

/* ─────────────────────────── 👤 PROFILE ───────────────────────────
 * Self-service account changes from /customer-shop/profile.
 * ───────────────────────────────────────────────────────────────── */

/**
 * Update the shopper's own name / phone.
 *
 * EMAIL IS DELIBERATELY NOT EDITABLE HERE. It is the login identifier, so
 * changing it needs its own re-verification flow (new address → OTP → only then
 * swap). Allowing it in a plain PATCH would let someone claim an address they
 * don't own.
 *
 * @param {string} consumerId
 * @param {object} patch { name?, phone? }
 */
async function updateProfile(consumerId, { name, phone } = {}) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);

  if (name !== undefined) {
    const next = String(name).trim();
    if (!next) throw httpErr("Name cannot be empty");
    if (next.length > 80) throw httpErr("Name is too long (max 80 characters)");
    consumer.name = next;
  }

  if (phone !== undefined) {
    const next = String(phone).replace(/\D/g, "");

    if (next) {
      if (next.length !== 10)
        throw httpErr("Please enter a valid 10-digit phone number");
      // phone carries a unique index — surface the clash as a clean 409 rather
      // than letting Mongo throw a raw E11000.
      const clash = await Consumer.findOne({
        phone: next,
        _id: { $ne: consumer._id },
      }).select("_id");
      if (clash)
        throw httpErr(
          "This phone number is already linked to another account",
          409,
        );
      consumer.phone = next;
    } else {
      // Clearing the phone is only allowed if an email remains — otherwise the
      // account would have NO way to log in.
      if (!consumer.email)
        throw httpErr(
          "You must keep either an email or a phone number on your account",
        );
      consumer.phone = undefined;
    }
  }

  await consumer.save();
  return publicConsumer(consumer);
}

/**
 * Change the account password. The current one is required.
 *
 * @param {string} consumerId
 * @param {object} body { currentPassword, newPassword }
 */
async function changePassword(
  consumerId,
  { currentPassword, newPassword } = {},
) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);

  if (!currentPassword) throw httpErr("Your current password is required");
  if (!newPassword || String(newPassword).length < 6) {
    throw httpErr("Password must be at least 6 characters");
  }

  const ok = await bcrypt.compare(
    String(currentPassword),
    consumer.passwordHash,
  );
  if (!ok) throw httpErr("Your current password is incorrect", 401);

  if (String(currentPassword) === String(newPassword)) {
    throw httpErr("Your new password must be different from the current one");
  }

  consumer.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await consumer.save();

  return { consumer: publicConsumer(consumer) };
}

/** Verify the email OTP for the logged-in consumer. */
async function verifyEmailOtp(consumerId, code) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);
  if (consumer.emailVerified) return { consumer: publicConsumer(consumer) };

  const otp = consumer.emailOtp;
  if (!otp?.codeHash || !otp.expiresAt)
    throw httpErr("No pending verification. Request a new code.");
  if (otp.expiresAt < new Date())
    throw httpErr("Code expired. Request a new code.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS)
    throw httpErr("Too many attempts. Request a new code.");

  if (hashOtp(code) !== otp.codeHash) {
    otp.attempts = (otp.attempts || 0) + 1;
    await consumer.save();
    throw httpErr("Incorrect code", 401);
  }

  consumer.emailVerified = true;
  consumer.emailOtp = undefined;
  await consumer.save();
  return { consumer: publicConsumer(consumer) };
}

/** Verify the SMS OTP for the logged-in consumer. */
async function verifyPhoneOtp(consumerId, code) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);
  if (consumer.phoneVerified) return { consumer: publicConsumer(consumer) };

  const otp = consumer.phoneOtp;
  if (!otp?.codeHash || !otp.expiresAt)
    throw httpErr("No pending verification. Request a new code.");
  if (otp.expiresAt < new Date())
    throw httpErr("Code expired. Request a new code.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS)
    throw httpErr("Too many attempts. Request a new code.");

  if (hashOtp(code) !== otp.codeHash) {
    otp.attempts = (otp.attempts || 0) + 1;
    await consumer.save();
    throw httpErr("Incorrect code", 401);
  }

  consumer.phoneVerified = true;
  consumer.phoneOtp = undefined;
  await consumer.save();
  return { consumer: publicConsumer(consumer) };
}

/** Resend the email OTP. */
async function resendEmailOtp(consumerId) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);
  if (consumer.emailVerified) return { alreadyVerified: true };
  const otp = await issueEmailOtp(consumer);
  return { otpSent: otp.delivered, smtp: otp.smtp };
}

/** Resend the SMS OTP. */
async function resendSmsOtp(consumerId) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);
  if (consumer.phoneVerified) return { alreadyVerified: true };
  const otp = await issueSmsOtp(consumer);
  return { otpSent: otp.delivered, sms: smsConfigured() };
}

/**
 * LIVE LOCATION CONSENT — what the shopper answered when the storefront asked
 * for their live location after registering / logging in.
 *
 * Denial is an ordinary answer, recorded so the next login knows to ask again.
 * Nothing else about the account depends on it: a shopper who never shares a
 * location keeps full access to the dashboard, the cart and checkout.
 */
async function saveLocationAccess(consumerId, body) {
  const patch = await buildLocationAccess(body);
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);
  applyLocationAccess(consumer, patch);
  await consumer.save();
  return publicConsumer(consumer);
}

/**
 * PREVIEW — resolve coordinates to a readable address WITHOUT saving anything.
 *
 * Backs the confirmation step: the shopper sees the state / district / town /
 * PIN we resolved and decides whether that is really where they are before any
 * of it is written. Nothing is persisted here, so a shopper who backs out at
 * the confirmation screen leaves no trace.
 */
async function previewLocation(body = {}) {
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw httpErr("latitude must be a number between -90 and 90", 400);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw httpErr("longitude must be a number between -180 and 180", 400);
  }
  const address = await reverseGeocode(latitude, longitude);
  return { latitude, longitude, address: address || null };
}

async function getMe(consumerId) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);
  return publicConsumer(consumer);
}

module.exports = {
  register,
  login,
  updateProfile,
  changePassword,
  verifyEmailOtp,
  resendEmailOtp,
  verifyPhoneOtp,
  resendSmsOtp,
  // OTP-first registration (account तभी बनता है जब code verify हो)
  sendRegistrationOtp,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  // 🔑 Forgot password (logged-out reset)
  sendPasswordResetOtp,
  resetPasswordWithOtp,
  resendPasswordResetOtp,
  getMe,
  saveLocationAccess,
  previewLocation,
  publicConsumer,
  signConsumerToken,
};
