// Thin SMS helper around SMS Gateway Hub API. Similar to mailerService.js
//
// ENDPOINT चुनने की बात: SMS Gateway Hub दो अलग URL देता है और दोनों का body
// अलग है —
//   /api/mt/SendSMS  (बड़े अक्षरों वाला) → flat query parameters
//   /api/mt/SendSms  (छोटे ms वाला)      → nested <SmsQueue> structure
// हम पहला वाला इस्तेमाल करते हैं, वही panel के "Single SMS" में दिखाया गया है.
// दूसरे पर flat parameters भेजने से gateway 500 लौटाता है.
const axios = require("axios");

const smsSender = {
  apiKey: process.env.SMS_GATEWAY_HUB_API_KEY,
  baseUrl: "https://www.smsgatewayhub.com/api/mt/SendSMS",
  // JBAGRO = SMS Gateway Hub पर approved sender ID. KHETFY अभी DLT approval
  // का इंतज़ार कर रहा है — approve होते ही .env में बदल देना, code नहीं.
  senderId: process.env.SMS_SENDER_ID || "JBAGRO",
  channel: 2, // Transactional (OTP ke liye)
  route: process.env.SMS_ROUTE || "1", // account का route id; default 1
  // DLT (TRAI) पहचान. दोनों हर transactional SMS के साथ जाना ज़रूरी है,
  // वरना gateway message स्वीकार नहीं करता.
  entityId: process.env.SMS_DLT_ENTITY_ID || "1701171203950932180",
  templateId: process.env.SMS_DLT_TEMPLATE_ID || "1777178939054905465",
};

/**
 * OTP message — DLT पर approved template से HUBAHU.
 *
 * Approved text:
 *   Your Khettify OTP is {#var#}. Valid for 10 minutes. Do not share this code. - JAIN BEEJ BHANDAR AGRO
 *
 * यहाँ एक अक्षर, एक comma, एक full stop भी बदला तो gateway
 * "006: Invalid template text" लौटा देगा. इसलिए यह पूरे system में OTP text
 * की इकलौती जगह है — कोई और file अपना version न लिखे.
 *
 * "Khettify" में दो t हैं — यह typo नहीं, approved template ऐसा ही है.
 */
const otpMessageText = (code) =>
  `Your Khettify OTP is ${code}. Valid for 10 minutes. Do not share this code. - JAIN BEEJ BHANDAR AGRO`;

const isConfigured = () => Boolean(process.env.SMS_GATEWAY_HUB_API_KEY);

/**
 * Send SMS via SMS Gateway Hub.
 * @param {string} number - Phone number (10-digit, e.g., "9898765432")
 * @param {string} text - SMS message text
 * @returns {Promise<{delivered, messageId, jobId}>}
 */
async function sendSMS({ number, text }) {
  if (!isConfigured()) {
    console.log(
      `[SMS] Not configured — SMS to ${number} was NOT sent.\n  Text: ${text}`,
    );
    return { delivered: false, configured: false };
  }

  // DEV ONLY — पूरा message (यानी OTP भी) console में. Production में यह
  // कभी print नहीं होता, इसलिए असली OTP logs में कभी नहीं जाएगा.
  if (process.env.NODE_ENV !== "production") {
    console.log(`\n🔑 [DEV] SMS to ${number}: ${text}\n`);
  }

  // Format: 10-digit → 12-digit with country code (India)
  // Input: "9898765432" → Output: "919898765432"
  const formattedNumber = number.startsWith("91") ? number : `91${number}`;

  try {
    // POST, पर सारे parameters query string में — यही shape gateway के
    // "Single SMS" example में है. axios params को खुद URL-encode करता है,
    // इसलिए message में space और punctuation सुरक्षित रहते हैं.
    const response = await axios.post(smsSender.baseUrl, null, {
      params: {
        APIKey: smsSender.apiKey,
        senderid: smsSender.senderId, // approved sender ID (DLT)
        channel: smsSender.channel, // 2 = Transactional (OTP)
        DCS: 0, // 0 = English text
        flashsms: 0, // 0 = Normal SMS (not flash)
        number: formattedNumber, // 919898765432 format
        text: text, // OTP message
        route: smsSender.route,
        // DLT पहचान — इनके बिना approved template भी reject होता है.
        EntityId: smsSender.entityId,
        dlttemplateid: smsSender.templateId,
      },
      timeout: 15000,
    });

    // Success response format from SMS Gateway Hub
    if (response.data.ErrorCode === "000") {
      const messageId = response.data.MessageData?.[0]?.MessageId;
      const jobId = response.data.JobId;

      console.log(`[SMS] Sent to ${number}`);
      console.log(`  JobId: ${jobId}`);
      console.log(`  MessageId: ${messageId}`);

      return { delivered: true, messageId, jobId };
    }

    // Gateway ने 200 लौटाया पर काम नहीं हुआ — ErrorCode बताता है क्यों.
    // (024 = template mismatch, 015 = senderid not valid, 021 = no credits)
    const errorMsg = response.data.ErrorMessage || "Unknown error";
    console.error(
      `[SMS] Gateway error (${response.data.ErrorCode}): ${errorMsg}`,
    );
    throw new Error(errorMsg);
  } catch (error) {
    // Gateway का असली जवाब भी छापो. इसके बिना "status code 500" से यह पता
    // ही नहीं चलता कि request में क्या गलत था.
    if (error.response) {
      console.error(
        `[SMS] Failed to send to ${number} — HTTP ${error.response.status}`,
      );
      console.error(
        `  Gateway said: ${JSON.stringify(error.response.data)?.slice(0, 500)}`,
      );
    } else {
      console.error(`[SMS] Failed to send to ${number}:`, error.message);
    }
    throw error;
  }
}

module.exports = {
  sendSMS,
  isConfigured,
  otpMessageText,
};
