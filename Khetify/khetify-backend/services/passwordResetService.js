const crypto = require("crypto");
const { sendMail } = require("./mailerService");

/**
 * The email password-reset primitives, in one place.
 *
 * The COMPANY member flow (controller/User/userController) and the COMPANY owner
 * flow (controller/Company/companyController) each grew their own copy of these
 * three things: a 1-hour TTL, a SHA-256 hash of the token at rest, and the reset
 * email itself. A SELLER member had no flow at all — `forgotPassword` is
 * hard-scoped to `ownerType: "company"` — so rather than write a fourth copy for
 * the seller, the shared parts live here and the seller controller uses them.
 *
 * THE EXISTING COMPANY CONTROLLERS ARE DELIBERATELY LEFT ALONE. They keep their
 * own local constants, so this module cannot change how a company reset behaves
 * today; it only means the seller flow is identical by construction rather than
 * by copy-paste. They can adopt it later, as a separate change, with the reset
 * emails already proven to match.
 */

/** How long a reset link stays valid. Matches the company flows exactly. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * ONLY THE HASH IS STORED. The raw token goes in the emailed link and is never
 * written down, so a leaked database cannot be used to reset anyone's password.
 */
const hashResetToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/** A fresh random token: the raw value for the link, the hash for the record. */
function newResetToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  return {
    raw,
    hash: hashResetToken(raw),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  };
}

/** The reset link, built from FRONTEND_URL with a trailing slash trimmed. */
function resetUrlFor(rawToken, type) {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${base}/reset-password?token=${rawToken}&type=${type}`;
}

/**
 * Send the reset email. Byte-for-byte the same message the company flow sends —
 * same subject, same wording, same button — because a seller manager and a
 * company manager are both just "a Khetify user resetting a password", and two
 * different-looking emails would be a support problem, not a feature.
 *
 * Throws on failure so the caller can roll the token back rather than leaving a
 * live reset behind for a mail that never arrived.
 */
async function sendResetEmail({ to, resetUrl }) {
  await sendMail({
    to,
    subject: "Reset your Khetify password",
    text: `We received a request to reset your Khetify password.\n\nOpen this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#EA2831">Khetify</h2>
        <p>We received a request to reset your password.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#EA2831;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Reset Password</a>
        </p>
        <p style="color:#666;font-size:13px">This link is valid for 1 hour. If you didn't request a reset, ignore this email.</p>
        <p style="color:#999;font-size:12px">Or paste this link into your browser:<br/>${resetUrl}</p>
      </div>`,
  });
}

module.exports = {
  RESET_TOKEN_TTL_MS,
  hashResetToken,
  newResetToken,
  resetUrlFor,
  sendResetEmail,
};