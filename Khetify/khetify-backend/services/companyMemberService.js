const bcrypt = require("bcryptjs");
const User = require("../model/User/User");
// The SAME mailer the customer OTP flow uses (services/shopAuthService.js ->
// issueEmailOtp) and the company password-reset flow. No second email
// service, no second transport, no second set of SMTP env vars.
const { sendMail } = require("./mailerService");

/**
 * COMPANY MEMBER SERVICE
 *
 * One place that knows how a company team member is validated and written, so
 * the two callers stay in lockstep and no logic is duplicated:
 *
 *   • controller/Warehouse/warehouseController.createWarehouse
 *       — the NEW flow: a Warehouse Manager is created with the warehouse and
 *         assigned to it in the same operation.
 *   • controller/User/userController.createUser
 *       — the existing POST /api/users endpoint, now sharing the same
 *         uniqueness rules.
 *
 * No new model and no schema change: this writes plain model/User/User.js
 * documents exactly as before.
 */

/**
 * The role a warehouse manager is created with. `operations_manager` is the
 * ACTIVE consolidated warehouse/operations role in config/permissions.js
 * (WAREHOUSE_ROLES); `warehouse_manager` is the legacy value kept only so old
 * records keep rendering. Deliberately reusing the existing role — no enum
 * change, so RBAC, warehouseScope and every existing gate behave identically.
 */
const WAREHOUSE_MANAGER_ROLE = "operations_manager";

/**
 * Company members are matched GLOBALLY at login: userController.loginUser looks
 * up `{ ownerType: "company", $or: [{ email }, { phone }] }` with no company
 * filter. So an email/phone has to be unique across ALL company members, not
 * merely within one company — two companies sharing an email would make the
 * login resolve to whichever record Mongo returned first.
 *
 * Records written before `ownerType` existed have no such field; they are
 * company members too, so they're included here.
 */
const COMPANY_MEMBER_SCOPE = {
  $or: [{ ownerType: "company" }, { ownerType: { $exists: false } }, { ownerType: null }],
};

const normalizeEmail = (v) => (v == null ? "" : String(v).trim().toLowerCase());
const normalizePhone = (v) => (v == null ? "" : String(v).trim());
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Reject a duplicate email or phone among company members.
 *
 * Email is compared case-insensitively (an anchored regex, so an existing
 * "Ravi@X.com" still clashes with "ravi@x.com"). Pass `excludeId` to let a
 * record keep its own identity when updating.
 *
 * Throws a 409 with a field-specific message; returns silently when free.
 */
async function assertUniqueIdentity({ email, phone, excludeId, session } = {}) {
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(phone);

  const identity = [];
  if (cleanEmail) identity.push({ email: new RegExp(`^${escapeRegex(cleanEmail)}$`, "i") });
  if (cleanPhone) identity.push({ phone: cleanPhone });
  if (!identity.length) return;

  const filter = { $and: [COMPANY_MEMBER_SCOPE, { $or: identity }] };
  if (excludeId) filter._id = { $ne: excludeId };

  const clash = await User.findOne(filter).select("email phone").session(session || null);
  if (!clash) return;

  const sameEmail = !!cleanEmail && normalizeEmail(clash.email) === cleanEmail;
  throw fail(
    sameEmail
      ? "This email is already registered to another team member."
      : "This phone number is already registered to another team member.",
    409
  );
}

/**
 * Create a company team member.
 *
 * `session` is optional: pass the session from services/txn.withTransaction so
 * the write joins an in-flight transaction (replica set), or omit it on a
 * standalone deployment — the caller is then responsible for compensating.
 *
 * Returns the created user WITHOUT its passwordHash.
 */
async function createCompanyMember({
  companyId,
  name,
  email,
  phone,
  password,
  role,
  warehouseIds,
  session,
} = {}) {
  if (!companyId) throw fail("companyId is required");

  const cleanName = String(name || "").trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(phone);
  const cleanPassword = String(password || "").trim();

  if (!cleanName) throw fail("Name is required");
  if (!cleanEmail) throw fail("Email is required");
  if (!cleanPhone) throw fail("Phone is required");

  // Re-checked here (and not only by the caller) so every write path is guarded,
  // and so the check runs INSIDE the transaction when there is one.
  await assertUniqueIdentity({ email: cleanEmail, phone: cleanPhone, session });

  const passwordHash = cleanPassword ? await bcrypt.hash(cleanPassword, 10) : undefined;

  const doc = {
    ownerType: "company",
    ownerId: companyId,
    companyId,
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    role: role || WAREHOUSE_MANAGER_ROLE,
    // Same rule the old createUser used: a password means the member can sign
    // in right away, otherwise the account waits as "invited".
    status: cleanPassword ? "active" : "invited",
    passwordHash,
    warehouseIds: Array.isArray(warehouseIds) ? warehouseIds : [],
  };

  // Array form is required for `create` to accept a session.
  const [user] = await User.create([doc], session ? { session } : {});

  const out = user.toObject();
  delete out.passwordHash;
  return out;
}

const escapeHtml = (v) =>
  String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Welcome a freshly created Warehouse Manager with their login credentials.
 *
 * Uses the shared services/mailerService.sendMail — the exact same helper
 * behind the customer OTP email and the company password-reset email. That
 * means it inherits the existing three-mode transport (real SMTP → Ethereal
 * test account → console log) and the existing MAIL_FROM / SMTP_* env, so
 * nothing new has to be configured and the OTP flow is untouched.
 *
 * The caller is responsible for only invoking this AFTER the warehouse and
 * the manager have both been committed.
 *
 * `password` is the plaintext temporary password typed on the Add Warehouse
 * form. It exists only in this request's memory and is written to the email
 * body alone — never logged, never persisted (User stores a bcrypt hash).
 *
 * `loginPath` is OPTIONAL and defaults to "" — i.e. the app root, which is the
 * company sign-in page. It exists so the SELLER warehouse flow can reuse this
 * exact template/transport and point its manager at "/seller/login" instead.
 * Every existing company caller omits it and therefore produces the identical
 * email it produced before.
 *
 * Throws whatever sendMail throws; the caller decides how to handle it.
 */
async function sendWarehouseManagerWelcomeEmail({
  managerName,
  email,
  password,
  companyName,
  warehouseName,
  loginPath = "",
} = {}) {
  if (!email) return { skipped: true, reason: "no-email" };

  // Same env + fallback the password-reset email already uses.
  const baseUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  // Normalise so "seller/login" and "/seller/login" both work, and so an
  // omitted path yields exactly the previous value (baseUrl unchanged).
  const path = loginPath ? `/${String(loginPath).replace(/^\/+/, "")}` : "";
  const loginUrl = `${baseUrl}${path}`;

  const name = managerName || "there";
  const company = companyName || "your company";
  const warehouse = warehouseName || "a warehouse";

  const text =
    `Hi ${name},\n\n` +
    `You have been assigned as the Warehouse Manager for ${warehouse} at ${company}.\n\n` +
    `Here are your login details:\n` +
    `  Company:   ${company}\n` +
    `  Warehouse: ${warehouse}\n` +
    `  Login URL: ${loginUrl}\n` +
    `  Email:     ${email}\n` +
    `  Temporary password: ${password}\n\n` +
    `Please sign in and change your password as soon as possible.\n`;

  const row = (label, value) =>
    `<tr>
       <td style="padding:6px 12px 6px 0;color:#666;font-size:13px;white-space:nowrap">${escapeHtml(label)}</td>
       <td style="padding:6px 0;font-size:14px;font-weight:bold;color:#14201A">${escapeHtml(value)}</td>
     </tr>`;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;color:#14201A">
      <h2 style="color:#EA2831;margin-bottom:4px">Khetify</h2>
      <p style="font-size:15px">Hi ${escapeHtml(name)},</p>
      <p style="font-size:15px;line-height:1.6">
        You have been assigned as the <strong>Warehouse Manager</strong> for
        <strong>${escapeHtml(warehouse)}</strong> at <strong>${escapeHtml(company)}</strong>.
      </p>
      <table style="border-collapse:collapse;margin:18px 0">
        ${row("Company", company)}
        ${row("Warehouse", warehouse)}
        ${row("Login email", email)}
        ${row("Temporary password", password)}
      </table>
      <p>
        <a href="${loginUrl}" style="display:inline-block;background:#EA2831;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Log in to Khetify</a>
      </p>
      <p style="color:#666;font-size:13px">
        Please sign in and change your password as soon as possible.
      </p>
      <p style="color:#999;font-size:12px">Or paste this link into your browser:<br/>${loginUrl}</p>
    </div>`;

  await sendMail({
    to: email,
    subject: `You're the Warehouse Manager for ${warehouse} — Khetify`,
    text,
    html,
  });

  return { skipped: false };
}

module.exports = {
  WAREHOUSE_MANAGER_ROLE,
  COMPANY_MEMBER_SCOPE,
  assertUniqueIdentity,
  sendWarehouseManagerWelcomeEmail,
  createCompanyMember,
};