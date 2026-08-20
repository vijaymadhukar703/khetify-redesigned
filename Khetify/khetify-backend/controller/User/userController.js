const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../model/User/User");
const audit = require("../../services/auditService");
const { ASSIGNABLE_ROLES } = require("../../config/permissions");
const Warehouse = require("../../model/Warehouse/Warehouse");
const companyMember = require("../../services/companyMemberService");
const crypto = require("crypto");
// The SAME mailer behind the customer OTP email (services/shopAuthService.js)
// and the company password-reset email. No second email service.
const { sendMail } = require("../../services/mailerService");
const { isEmail } = require("../../utils/fieldValidators");

// Identical to the company reset flow in controller/Company/companyController.js
// so both links behave the same way and expire on the same schedule.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const hashResetToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/** Tenant safety: only warehouses belonging to THIS company can be assigned. */
async function validCompanyWarehouses(companyId, warehouseIds) {
  if (!Array.isArray(warehouseIds)) return undefined;
  if (!warehouseIds.length) return [];
  const count = await Warehouse.countDocuments({ _id: { $in: warehouseIds }, companyId });
  if (count !== new Set(warehouseIds.map(String)).size) {
    const err = new Error("One or more warehouses don't belong to this company");
    err.status = 400;
    throw err;
  }
  return warehouseIds;
}

/**
 * POST /api/users/login  { email | phone, password }
 * Team-member login (operations_manager, sales_manager, ...). Issues the same
 * JWT shape the rest of the stack expects — { id, companyId, role } — so
 * authorize() and the frontend usePermission() gating work out of the box.
 * The company owner keeps logging in via POST /api/company/login (unchanged).
 */
exports.loginUser = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    if (!password || (!email && !phone)) {
      return res.status(400).json({ success: false, message: "Email/Phone and password required" });
    }

    const query = [];
    if (email) query.push({ email: String(email).toLowerCase().trim() });
    if (phone) query.push({ phone: String(phone).trim() });

    // SECURITY: the User collection holds BOTH company and seller members
    // (ownerType "company" | "seller"). This is the COMPANY team-login endpoint,
    // so it must match COMPANY members only — a seller member's credentials must
    // NOT authenticate here. Sellers sign in via /api/seller/login. We return the
    // SAME generic "Invalid credentials" so we never reveal the account exists on
    // the other side.
    const user = await User.findOne({ ownerType: "company", $or: query });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ success: false, message: `Account is ${user.status} — ask your company admin` });
    }

    const isMatch = await bcrypt.compare(String(password).trim(), user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, companyId: user.companyId, role: user.role, warehouseIds: (user.warehouseIds || []).map(String) },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    user.lastLoginAt = new Date();
    await user.save();

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        companyId: user.companyId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        warehouseIds: user.warehouseIds || [],
      },
    });
  } catch (err) {
    console.error("loginUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/change-password  { currentPassword, newPassword }
 *
 * Signed-in team member changes their OWN password. Scoped by req.user.id
 * from the JWT, so a member can never target another account. Used by the
 * Warehouse Manager settings page; available to any team member.
 *
 * NOTE: the COMPANY OWNER account is a Company document, not a User, so its
 * token's id won't resolve here — owners keep using the company flow. That
 * is why the miss returns a plain 404 rather than anything role-specific.
 */
exports.changePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "").trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }
    if (newPassword === currentPassword.trim()) {
      return res.status(400).json({ success: false, message: "New password must be different from the current one" });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.passwordHash) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    const ok = await bcrypt.compare(currentPassword.trim(), user.passwordHash);
    if (!ok) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    // Any half-finished email reset is void once the password changes by hand.
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    await audit.log({
      req,
      action: "user.password_changed",
      entityType: "User",
      entityId: user._id,
    });

    res.json({ success: true, message: "Password updated" });
  } catch (err) {
    console.error("changePassword error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/forgot-password  { email }   (public — no auth)
 *
 * Emails a one-time reset link to a COMPANY team member. Deliberately a
 * near-copy of controller/Company/companyController.forgotPassword — same
 * 1-hour TTL, same SHA-256-hashed token at rest, same generic response so the
 * endpoint can't be used to discover which emails are registered, and the
 * same rollback if the mail fails so no dangling reset is left behind.
 *
 * Reuses services/mailerService.sendMail — the shared transport already used
 * by the customer OTP email.
 */
exports.forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!email || !isEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }

    // Same generic reply on every path — found, not found, or disabled.
    const genericResponse = {
      success: true,
      message: "If an account exists for that email, a reset link has been sent.",
    };

    // COMPANY members only; seller members reset via the seller portal.
    const user = await User.findOne({ ownerType: "company", email });
    if (!user || user.status === "disabled") return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = hashResetToken(rawToken);
    user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    // `type=member` tells the shared reset page to POST to the MEMBER endpoint.
    // Without it the page keeps its existing company behaviour.
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}&type=member`;

    try {
      await sendMail({
        to: email,
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
    } catch (mailErr) {
      // Roll back so a failed send doesn't leave a live token behind.
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();
      return res.status(502).json({ success: false, message: "Could not send the reset email. Please try again later." });
    }

    res.json(genericResponse);
  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users/reset-password  { token, password }   (public — no auth)
 * Consumes the emailed token. Mirrors the company reset endpoint.
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.body;
    const password = String(req.body.password || "").trim();

    if (!token || typeof token !== "string") {
      return res.status(400).json({ success: false, message: "Reset token is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({
      ownerType: "company",
      resetPasswordToken: hashResetToken(token),
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Reset link is invalid or has expired" });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    // An "invited" member who resets via email has proven ownership of the
    // mailbox, so let them in. A DISABLED account stays disabled.
    if (user.status === "invited") user.status = "active";
    await user.save();

    res.json({ success: true, message: "Password reset successful. You can now log in." });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/users — team members for the company. */
exports.getUsers = async (req, res) => {
  try {
    const rows = await User.find({ companyId: req.user.companyId })
      .select("-passwordHash")
      .populate("warehouseIds", "name code")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getUsers error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/users  { name, email, phone, role, password, warehouseIds? }
 *
 * The Company Panel no longer creates members here — warehouse managers are
 * created with their warehouse (POST /api/warehouse). The endpoint is kept
 * intact for API compatibility and now shares services/companyMemberService,
 * so it enforces the SAME unique-email / unique-phone rule as that flow
 * instead of a second copy of the logic.
 */
exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, role, password, warehouseIds } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name is required" });
    if (role && !ASSIGNABLE_ROLES.includes(role))
      return res.status(400).json({ success: false, message: "Invalid role" });

    const assignedWarehouses = await validCompanyWarehouses(req.user.companyId, warehouseIds);
    const out = await companyMember.createCompanyMember({
      companyId: req.user.companyId,
      name,
      email,
      phone,
      password,
      role,
      warehouseIds: assignedWarehouses,
    });

    await audit.log({
      req,
      action: "user.created",
      entityType: "User",
      entityId: out._id,
      after: { name: out.name, email: out.email, role: out.role, warehouseIds: out.warehouseIds },
    });
    res.json({ success: true, message: "Team member added", data: out });
  } catch (err) {
    console.error("createUser error:", err);
    res
      .status(err.status || 500)
      .json({ success: false, message: err.status ? err.message : "Server error" });
  }
};

/** PATCH /api/users/:id  { role?, status? } */
exports.updateUser = async (req, res) => {
  try {
    const patch = {};
    if (req.body.role) {
      if (!ASSIGNABLE_ROLES.includes(req.body.role))
        return res.status(400).json({ success: false, message: "Invalid role" });
      patch.role = req.body.role;
    }
    if (req.body.status) patch.status = req.body.status;
    if (req.body.name) patch.name = req.body.name;
    if (req.body.phone) patch.phone = req.body.phone;
    if (req.body.warehouseIds !== undefined) {
      patch.warehouseIds = await validCompanyWarehouses(req.user.companyId, req.body.warehouseIds);
    }

    const prev = await User.findOne({ _id: req.params.id, companyId: req.user.companyId }).select(
      "-passwordHash"
    );
    if (!prev) return res.status(404).json({ success: false, message: "User not found" });

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId },
      patch,
      { new: true }
    ).select("-passwordHash");

    if (patch.warehouseIds !== undefined && String(prev.warehouseIds) !== String(patch.warehouseIds)) {
      await audit.log({
        req,
        action: "user.warehouses_assigned",
        entityType: "User",
        entityId: user._id,
        before: { warehouseIds: prev.warehouseIds },
        after: { warehouseIds: user.warehouseIds },
      });
    }
    if (patch.role && patch.role !== prev.role) {
      await audit.log({
        req,
        action: "user.role_changed",
        entityType: "User",
        entityId: user._id,
        before: { role: prev.role },
        after: { role: user.role },
      });
    }
    res.json({ success: true, message: "Updated", data: user });
  } catch (err) {
    console.error("updateUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** DELETE /api/users/:id */
exports.deleteUser = async (req, res) => {
  try {
    const r = await User.findOneAndDelete({ _id: req.params.id, companyId: req.user.companyId });
    if (!r) return res.status(404).json({ success: false, message: "User not found" });
    await audit.log({
      req,
      action: "user.deleted",
      entityType: "User",
      entityId: r._id,
      before: { name: r.name, role: r.role },
    });
    res.json({ success: true, message: "Removed" });
  } catch (err) {
    console.error("deleteUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};