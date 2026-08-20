const { z } = require("zod");
const { ASSIGNABLE_ROLES, SELLER_ASSIGNABLE_ROLES } = require("../config/permissions");

// Operational roles are consolidated to company_admin / operations_manager /
// sales_manager. Legacy roles on EXISTING users keep working (User model enum
// still lists them) — they just can't be assigned via the team API anymore.
const assignable = ASSIGNABLE_ROLES;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

// Add Team Member — every visible field is mandatory (name, email, phone, role,
// temporary password). `.trim()` runs BEFORE the checks, so a whitespace-only
// value is treated as empty and rejected. This is the server-side guard behind
// the form: the API rejects missing/empty values even if the UI is bypassed.
// Shared field rules so the company and seller schemas stay identical except for
// their role set. Password rule is the project's existing min(6)/max(100).
// required_error covers a MISSING key (undefined); the trimmed .min/.regex cover
// an empty or whitespace-only value — both yield the same clear message.
const memberName = z.string({ required_error: "Name is required" }).trim().min(1, "Name is required");
const memberEmail = z.string({ required_error: "Email is required" }).trim().min(1, "Email is required").email("Enter a valid email");
const memberPhone = z.string({ required_error: "Phone is required" }).trim().regex(/^\d{10}$/, "Phone must be a valid 10-digit mobile number");
const memberPassword = z.string({ required_error: "Temporary Password is required" }).trim().min(6, "Temporary Password must be at least 6 characters").max(100);
const memberRole = (roles) => z.enum(roles, { errorMap: () => ({ message: "Role is required" }) });

const createUserBody = z.object({
  name: memberName,
  email: memberEmail,
  phone: memberPhone,
  role: memberRole(assignable),
  password: memberPassword,
  // Warehouse-level access: the warehouses this user is assigned to.
  warehouseIds: z.array(objectId).max(50).optional(),
});

// Seller Add Team Member — same mandatory fields, seller role set. The seller
// team route had NO schema before (validation was a manual `if (!name)`); this
// brings it to parity with the company route so both reject missing/empty values.
const createSellerMemberBody = z.object({
  name: memberName,
  email: memberEmail,
  phone: memberPhone,
  role: memberRole(SELLER_ASSIGNABLE_ROLES),
  password: memberPassword,
  warehouseIds: z.array(objectId).max(50).optional(),
});

const updateUserBody = z
  .object({
    name: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    role: z.enum(assignable).optional(),
    status: z.enum(["active", "invited", "disabled"]).optional(),
    warehouseIds: z.array(objectId).max(50).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

const loginUserBody = z
  .object({
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    password: z.string().min(1),
  })
  .refine((b) => b.email || b.phone, { message: "email or phone is required" });

// The individual field rules are exported too so validators/warehouseValidators.js
// can reuse them for the Warehouse Manager block instead of restating them.
module.exports = {
  createUserBody, createSellerMemberBody, updateUserBody, loginUserBody,
  memberName, memberEmail, memberPhone, memberPassword, memberRole,
};