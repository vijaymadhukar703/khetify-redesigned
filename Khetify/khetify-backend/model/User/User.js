const mongoose = require("mongoose");
const { ROLES } = require("../../config/permissions");

/**
 * A team member under a company account. Roles drive RBAC via the
 * authorize() middleware (the JWT carries { id, companyId, role }).
 *
 * `pin` is a bcrypt hash used for driver mobile login (phone + PIN). Never
 * store the raw PIN. `passwordHash` is for email/password logins.
 */
const userSchema = new mongoose.Schema(
  {
    // Owner-polymorphic: a team member belongs to a company OR a seller.
    // `ownerType`/`ownerId` are the canonical owner; `companyId` is kept
    // populated for company users (legacy queries + tenant scoping unchanged).
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    passwordHash: { type: String },
    pin: { type: String }, // bcrypt hash, driver mobile login
    // PASSWORD RESET (email link flow). Mirrors model/Company/Company.js:
    // stores a SHA-256 hash of the token that was emailed, never the raw
    // token, plus its expiry. Additive — every existing document simply has
    // these unset, which reads as 'no reset in progress'.
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    role: {
      type: String,
      enum: ROLES,
      // Consolidated role structure: new team members default to the
      // operations role. Legacy roles stay valid on existing records.
      default: "operations_manager",
    },
    // Warehouse-level access control. An operations user assigned here only
    // sees/operates on these warehouses (services/warehouseScope.js). Stored
    // as an ARRAY so a warehouse can have many users and a user can later
    // cover several warehouses without a schema redesign. Empty = unscoped
    // (legacy behaviour: sees all warehouses). Ignored for "*" roles.
    warehouseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" }],
    status: { type: String, enum: ["active", "invited", "disabled"], default: "active" },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ ownerType: 1, ownerId: 1, email: 1 });
userSchema.index({ ownerType: 1, ownerId: 1, phone: 1 });
userSchema.index({ companyId: 1, email: 1 }); // legacy company lookups
userSchema.index({ companyId: 1, phone: 1 });

module.exports = mongoose.model("User", userSchema);