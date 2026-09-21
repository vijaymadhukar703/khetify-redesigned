/**
 * SMS Gateway Hub Configuration
 * Centralized SMS settings for OTP and other transactional messages
 */

module.exports = {
  // SMS Gateway Hub API
  SMS_GATEWAY_HUB_API_KEY: process.env.SMS_GATEWAY_HUB_API_KEY,
  SMS_SENDER_ID: process.env.SMS_SENDER_ID || "KHETFY",
  SMS_CHANNEL: 2, // Transactional (for OTP)
  // 🆔 DLT-approved Template ID (from the STPL/DLT portal — "Template Id" field
  // on the approved "Khetify" OTP template). Required by SMS Gateway Hub on
  // every transactional send, or the gateway rejects the request (HTTP 500).
  SMS_DLT_TEMPLATE_ID: process.env.SMS_DLT_TEMPLATE_ID || "1777178939054905465",

  // OTP Configuration
  OTP_EXPIRY_MINUTES: 10, // OTP valid for 10 minutes
  OTP_LENGTH: 6, // 6-digit OTP
  OTP_MAX_ATTEMPTS: 5, // Max 5 verification attempts before expiry

  // SMS Message Template
  // ⚠️ MUST MATCH THE DLT-APPROVED TEMPLATE **EXACTLY** (character for
  // character, only the OTP digits vary) or the gateway rejects the send.
  // Approved content: "Your Khetify OTP is {#var#}. Valid for 10 minutes.
  // Do not share this code. - JAIN BEEJ BHANDAR AGRO"
  OTP_MESSAGE_TEMPLATE: (code) =>
    `Your Khetify OTP is ${code}. Valid for 10 minutes. Do not share this code. - JAIN BEEJ BHANDAR AGRO`,
};
