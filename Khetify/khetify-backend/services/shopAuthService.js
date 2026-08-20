const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Consumer = require("../model/Shop/Consumer");
const { sendMail, smtpConfigured } = require("./mailerService");

/**
 * Storefront (customer-shop) auth: register / login with email OR phone +
 * password, plus optional email-OTP verification via the shared mailerService.
 * No SMS — phone is contact info only.
 *
 * 👤 PROFILE (additive): updateProfile() and changePassword() back the
 * self-service account hub at /customer-shop/profile. Both are scoped by the
 * consumerId taken from the JWT, so a shopper can only ever touch their OWN
 * document.
 */

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

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
    { expiresIn: "30d" }
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
    addresses: c.addresses || [],
  };
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

/** Generate + email a 6-digit OTP. Returns whether it was actually delivered. */
async function issueEmailOtp(consumer) {
  if (!consumer.email) return { delivered: false, reason: "no-email" };
  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  consumer.emailOtp = { codeHash: hashOtp(code), expiresAt: new Date(Date.now() + OTP_TTL_MS), attempts: 0 };
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

/** Register a new shopper. Duplicate email/phone → 409. */
async function register({ name, email, phone, password }) {
  name = (name || "").trim();
  email = (email || "").trim().toLowerCase() || undefined;
  phone = (phone || "").trim() || undefined;
  if (!name) throw httpErr("Name is required");
  if (!email && !phone) throw httpErr("Email or phone is required");
  if (!password || String(password).length < 6) throw httpErr("Password must be at least 6 characters");

  const or = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  const existing = or.length ? await Consumer.findOne({ $or: or }) : null;
  if (existing) throw httpErr("An account with this email or phone already exists", 409);

  const passwordHash = await bcrypt.hash(String(password), 10);
  const consumer = await Consumer.create({ name, email, phone, passwordHash });

  let otp = { delivered: false };
  if (email) {
    try { otp = await issueEmailOtp(consumer); } catch { /* email is best-effort; account still created */ }
  }
  return { token: signConsumerToken(consumer), consumer: publicConsumer(consumer), otpSent: otp.delivered };
}

/** Login with email OR phone (the `identifier`) + password. */
async function login({ identifier, password }) {
  identifier = (identifier || "").trim();
  if (!identifier || !password) throw httpErr("Email/phone and password are required");

  const consumer = await Consumer.findOne({
    $or: [{ email: identifier.toLowerCase() }, { phone: identifier }],
  });
  if (!consumer || !(await bcrypt.compare(String(password), consumer.passwordHash))) {
    throw httpErr("Invalid credentials", 401);
  }
  if (consumer.status === "disabled") throw httpErr("Account disabled", 403);

  consumer.lastLoginAt = new Date();
  await consumer.save();
  return { token: signConsumerToken(consumer), consumer: publicConsumer(consumer) };
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
      if (next.length !== 10) throw httpErr("Please enter a valid 10-digit phone number");
      // phone carries a unique index — surface the clash as a clean 409 rather
      // than letting Mongo throw a raw E11000.
      const clash = await Consumer.findOne({ phone: next, _id: { $ne: consumer._id } }).select("_id");
      if (clash) throw httpErr("This phone number is already linked to another account", 409);
      consumer.phone = next;
    } else {
      // Clearing the phone is only allowed if an email remains — otherwise the
      // account would have NO way to log in.
      if (!consumer.email) throw httpErr("You must keep either an email or a phone number on your account");
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
async function changePassword(consumerId, { currentPassword, newPassword } = {}) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);

  if (!currentPassword) throw httpErr("Your current password is required");
  if (!newPassword || String(newPassword).length < 6) {
    throw httpErr("Password must be at least 6 characters");
  }

  const ok = await bcrypt.compare(String(currentPassword), consumer.passwordHash);
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
  if (!otp?.codeHash || !otp.expiresAt) throw httpErr("No pending verification. Request a new code.");
  if (otp.expiresAt < new Date()) throw httpErr("Code expired. Request a new code.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw httpErr("Too many attempts. Request a new code.");

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

/** Resend the email OTP. */
async function resendEmailOtp(consumerId) {
  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);
  if (consumer.emailVerified) return { alreadyVerified: true };
  const otp = await issueEmailOtp(consumer);
  return { otpSent: otp.delivered, smtp: otp.smtp };
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
  getMe,
  publicConsumer,
  signConsumerToken,
};