const mongoose = require("mongoose");

/**
 * A company registration that has been STARTED but not yet verified.
 *
 * यही वो बदलाव है जो बिना-सत्यापित email वाले account रोकता है: जब तक
 * registrant यह साबित न कर दे कि email उसी का है, Company collection में कुछ
 * नहीं लिखा जाता. गलत या fake email से असली account बन ही नहीं सकता — row
 * expire होकर गायब हो जाती है.
 *
 * Password यहाँ पहले से hashed आता है (कभी plain text नहीं), इसलिए यह row उस
 * Company document से ज़्यादा संवेदनशील नहीं जो यह आगे चलकर बनेगी.
 *
 * इस collection को और कोई नहीं पढ़ता. sendCompanyRegistrationOtp() लिखता है,
 * verifyCompanyRegistrationOtp() delete करता है.
 */
const pendingCompanySchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true, required: true },
    number: { type: String, required: true, trim: true },
    password: { type: String, required: true }, // already hashed

    // hash + expiry, कभी raw code नहीं — वही तरीका जो resetPasswordToken
    // में इस्तेमाल होता है.
    otp: {
      codeHash: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      attempts: { type: Number, default: 0 },
    },

    // Resend throttling — "resend" दबाकर mail भर देने से रोकता है.
    lastSentAt: { type: Date, default: Date.now },
    resendCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/**
 * AUTO-CLEANUP. बनने के 30 मिनट बाद Mongo खुद row delete कर देता है, इसलिए
 * अधूरी registration कुछ पीछे नहीं छोड़ती और वो email/number दोबारा free हो
 * जाते हैं. कोई cron job नहीं.
 */
pendingCompanySchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 });

/**
 * एक email पर एक ही pending registration — क्योंकि code उसी email पर जाता है.
 * उसी email से दूसरी कोशिश पहली को OVERWRITE करती है, यानी सिर्फ़ सबसे नया
 * code valid रहता है.
 */
pendingCompanySchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model(
  "PendingCompanyRegistration",
  pendingCompanySchema,
);
