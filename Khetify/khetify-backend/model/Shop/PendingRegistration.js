const mongoose = require("mongoose");

/**
 * A registration that has been STARTED but not yet verified.
 *
 * OTP-FIRST flow की पूरी बात यही है: जब तक shopper यह साबित न कर दे कि phone
 * number उसी का है, Consumer collection में कुछ नहीं लिखा जाता. इसलिए किसी
 * गलत या fake number से असली account बन ही नहीं सकता — pending row expire होकर
 * गायब हो जाती है.
 *
 * Password यहाँ पहले से hashed आता है (कभी plain text नहीं), इसलिए यह row उस
 * Consumer document से ज़्यादा संवेदनशील नहीं जो यह आगे चलकर बनेगी.
 *
 * इस collection को और कोई नहीं पढ़ता. sendRegistrationOtp() लिखता है,
 * verifyRegistrationOtp() delete करता है.
 */
const pendingRegistrationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },

    // Consumer.phoneOtp जैसा ही shape — hash + expiry, कभी raw code नहीं.
    otp: {
      codeHash: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      attempts: { type: Number, default: 0 },
    },

    // Resend throttling: "resend" button दबाकर SMS credits उड़ाने से रोकता है.
    // resendRegistrationOtp() में check होता है.
    lastSentAt: { type: Date, default: Date.now },
    resendCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/**
 * AUTO-CLEANUP. बनने के 30 मिनट बाद Mongo खुद row delete कर देता है, इसलिए
 * अधूरी registration कुछ पीछे नहीं छोड़ती और वो phone number दोबारा free हो
 * जाता है. कोई cron job नहीं, कोई manual sweep नहीं.
 */
pendingRegistrationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 });

/**
 * एक phone पर एक ही pending registration. उसी number से दूसरी कोशिश पहली को
 * OVERWRITE करती है (sendRegistrationOtp का upsert) — यही सही भी है, क्योंकि
 * सिर्फ़ सबसे नया code valid होना चाहिए.
 */
pendingRegistrationSchema.index({ phone: 1 }, { unique: true });

module.exports = mongoose.model(
  "PendingRegistration",
  pendingRegistrationSchema,
);
