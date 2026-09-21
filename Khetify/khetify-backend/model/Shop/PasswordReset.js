const mongoose = require("mongoose");

/**
 * A password reset that has been REQUESTED but not yet completed.
 *
 * PendingRegistration की तरह ही एक अस्थायी row. फ़र्क़ सिर्फ़ इतना है कि वहाँ
 * account बनना बाकी होता है, यहाँ account मौजूद है और उसका password बदलना
 * बाकी है.
 *
 * यहाँ न password रखा जाता है न कोई और निजी जानकारी — सिर्फ़ यह कि किस
 * account के लिए कौन-सा code भेजा गया. नया password तभी लिखा जाता है जब code
 * सही निकले, और तब यह row मिट जाती है.
 *
 * इस collection को और कोई नहीं पढ़ता. sendPasswordResetOtp() लिखता है,
 * resetPasswordWithOtp() delete करता है.
 */
const passwordResetSchema = new mongoose.Schema(
  {
    // किस account का reset है. phone से भी ढूँढ सकते थे, पर consumerId पक्का
    // है — बीच में shopper अपना number बदल दे तो भी यह row सही account पर
    // टिकी रहती है.
    consumerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consumer",
      required: true,
    },
    phone: { type: String, required: true, trim: true },

    // Consumer.phoneOtp जैसा ही shape — hash + expiry, कभी raw code नहीं.
    otp: {
      codeHash: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      attempts: { type: Number, default: 0 },
    },

    // Resend throttling — वही मक़सद जो PendingRegistration में है.
    lastSentAt: { type: Date, default: Date.now },
    resendCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/**
 * AUTO-CLEANUP. 30 मिनट बाद Mongo खुद row हटा देता है. एक भूला हुआ reset
 * request हमेशा के लिए खुला नहीं रहता — यही इसे सुरक्षित बनाता है.
 */
passwordResetSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 });

/**
 * एक phone पर एक ही चालू reset. दोबारा "forgot password" दबाने से पुरानी row
 * OVERWRITE होती है, इसलिए सिर्फ़ सबसे नया code valid रहता है.
 */
passwordResetSchema.index({ phone: 1 }, { unique: true });

module.exports = mongoose.model("PasswordReset", passwordResetSchema);
