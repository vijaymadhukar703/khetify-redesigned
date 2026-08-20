const bcrypt = require("bcryptjs");
const User = require("../model/User/User");
const Seller = require("../model/Seller/Seller");
// REUSED, not reimplemented: the seller warehouse manager gets the SAME welcome
// email (same template, same services/mailerService transport, same MAIL_FROM /
// SMTP_* env) the company warehouse manager already gets. The only difference
// is the loginPath it is pointed at — see createSellerWarehouse.
const { sendWarehouseManagerWelcomeEmail } = require("./companyMemberService");

/**
 * SELLER MEMBER SERVICE
 *
 * The seller-side mirror of services/companyMemberService.js. One place that
 * knows how a SELLER team member is validated and written, so the seller
 * Warehouse Manager flow has exactly the architecture the company flow has:
 *
 *   • controller/Seller/sellerWarehouseController.createSellerWarehouse
 *       — the NEW flow: a Warehouse Manager is created with the warehouse and
 *         assigned to it in the same operation.
 *
 * No new model and no schema change: this writes plain model/User/User.js
 * documents with { ownerType: "seller", ownerId: sellerId } — the exact shape
 * controller/Seller/sellerTeamController.js has always written, so the team
 * listing, warehouseScope, RBAC and the seller login all keep working with no
 * changes at all.
 */

/**
 * The role a SELLER warehouse manager is created with.
 *
 * `seller_manager` is the existing seller operations role in
 * config/permissions.js — it holds warehouse:read + warehouse:manage,
 * supply:*, transfer:*, label:*, customer:*, order:*, inventory:read and
 * report:read, but deliberately NOT warehouse:create, user:*, catalog:*,
 * billing:manage or company:manage (those resolve only via the seller_admin
 * "*"). That is precisely "warehouse manager", so we reuse it rather than
 * inventing a role: no enum change, no RBAC change, no migration.
 */
const SELLER_WAREHOUSE_MANAGER_ROLE = "seller_manager";

/**
 * Seller members are matched GLOBALLY at login:
 * controller/Seller/sellerAuthController.loginSeller looks up
 * `{ ownerType: "seller", $or: [{ email }, { phone }] }` with no sellerId
 * filter. So an email/phone has to be unique across ALL seller members, not
 * merely within one seller — two sellers sharing an email would make the login
 * resolve to whichever record Mongo returned first.
 */
const SELLER_MEMBER_SCOPE = { ownerType: "seller" };

const normalizeEmail = (v) => (v == null ? "" : String(v).trim().toLowerCase());
const normalizePhone = (v) => (v == null ? "" : String(v).trim());
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Reject a duplicate email or phone that would make this manager unable to
 * sign in, or would shadow someone else.
 *
 * Two collections are checked, because loginSeller reads both:
 *
 *  1. Seller ACCOUNTS — checked FIRST, and for the same reason loginSeller
 *     checks them first: a Seller doc matching the email always wins the
 *     password comparison, so a member created on a seller account's email
 *     could never log in. Better a clear 409 now than a silent dead account.
 *  2. Seller MEMBERS  — the direct clash.
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

  // 1. A seller ACCOUNT on the same email/phone would win at login.
  const accountClash = await Seller.findOne({ $or: identity })
    .select("email phone")
    .session(session || null);
  if (accountClash) {
    const sameEmail = !!cleanEmail && normalizeEmail(accountClash.email) === cleanEmail;
    throw fail(
      sameEmail
        ? "This email already belongs to a seller account — use a different one for the manager."
        : "This phone number already belongs to a seller account — use a different one for the manager.",
      409
    );
  }

  // 2. Another seller team member on the same email/phone.
  const filter = { $and: [SELLER_MEMBER_SCOPE, { $or: identity }] };
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
 * Create a seller team member.
 *
 * `session` is optional: pass the session from services/txn.withTransaction so
 * the write joins an in-flight transaction (replica set), or omit it on a
 * standalone deployment — the caller is then responsible for compensating.
 *
 * Returns the created user WITHOUT its passwordHash / pin.
 */
async function createSellerMember({
  sellerId,
  name,
  email,
  phone,
  password,
  role,
  warehouseIds,
  session,
} = {}) {
  if (!sellerId) throw fail("sellerId is required");

  const cleanName = String(name || "").trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(phone);
  const cleanPassword = String(password || "").trim();

  if (!cleanName) throw fail("Name is required");
  if (!cleanEmail) throw fail("Email is required");
  if (!cleanPhone) throw fail("Phone is required");
  // The manager must be able to sign in the moment the email lands, so unlike
  // the old "invite" flow a password is MANDATORY here.
  if (!cleanPassword) throw fail("Password is required");

  // Re-checked here (and not only by the caller) so every write path is guarded,
  // and so the check runs INSIDE the transaction when there is one.
  await assertUniqueIdentity({ email: cleanEmail, phone: cleanPhone, session });

  const passwordHash = await bcrypt.hash(cleanPassword, 10);

  const doc = {
    ownerType: "seller",
    ownerId: sellerId,
    // NOTE: companyId is deliberately left unset. A seller member belongs to a
    // seller, not a company; sellerTeamController has always written them this
    // way and every seller-scoped query keys off ownerType/ownerId.
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    role: role || SELLER_WAREHOUSE_MANAGER_ROLE,
    status: "active",
    passwordHash,
    warehouseIds: Array.isArray(warehouseIds) ? warehouseIds : [],
  };

  // Array form is required for `create` to accept a session.
  const [user] = await User.create([doc], session ? { session } : {});

  const out = user.toObject();
  delete out.passwordHash;
  delete out.pin;
  return out;
}

module.exports = {
  SELLER_WAREHOUSE_MANAGER_ROLE,
  SELLER_MEMBER_SCOPE,
  assertUniqueIdentity,
  createSellerMember,
  // Re-exported so the seller controller has ONE import surface. This is the
  // company service's function — the template is genuinely shared, not copied.
  sendWarehouseManagerWelcomeEmail,
};