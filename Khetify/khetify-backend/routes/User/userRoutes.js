const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const { createUserBody, updateUserBody, loginUserBody } = require("../../validators/userValidators");
const {
  loginUser,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  changePassword,
  forgotPassword,
  resetPassword,
} = require("../../controller/User/userController");

// Team-member login (no auth — issues the JWT). Owners use /api/company/login.
router.post("/login", validate({ body: loginUserBody }), loginUser);

// ── ACCOUNT SELF-SERVICE ──
// Password management for the signed-in member, plus the public email-reset
// pair. NONE of these carry `adminGate`: getting back into your own account
// must not depend on the company's subscription. They also need no
// capability — every route below is scoped to the caller's OWN account
// (req.user.id) or to a one-time emailed token.
router.post("/change-password", auth, changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Company tokens carry role "company_admin" (holds "*"), so existing behaviour
// is unchanged. Sub-user roles are gated by the user:* capabilities below.
// Team & Roles is an ADMINISTRATION module — gated on the paid ADMINISTRATION
// feature, the same loadSubscription + requireFeature pattern every other
// module uses. Team LOGIN above is deliberately NOT gated: a member must
// still be able to sign in and reach Billing to subscribe.
const adminGate = [loadSubscription, requireFeature(FEATURES.ADMINISTRATION)];
router.get("/", auth, authorize("user:read"), ...adminGate, getUsers);
router.post("/", auth, authorize("user:create"), ...adminGate, validate({ body: createUserBody }), createUser);
router.patch("/:id", auth, authorize("user:update"), ...adminGate, validate({ body: updateUserBody }), updateUser);
router.delete("/:id", auth, authorize("user:delete"), ...adminGate, deleteUser);

module.exports = router;