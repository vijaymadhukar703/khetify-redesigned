const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createSellerMemberBody } = require("../../validators/userValidators");
const { getTeam, createMember, updateMember, deleteMember } = require("../../controller/Seller/sellerTeamController");

// Seller team management — only roles holding user:read / user:manage (i.e.
// seller_admin) can view/manage the team; seller_manager/staff are blocked.
router.use(auth);
router.get("/", authorize("user:read"), getTeam);
// All Add Team Member fields are mandatory — validated here, not just in the UI.
router.post("/", authorize("user:manage"), validate({ body: createSellerMemberBody }), createMember);
router.patch("/:id", authorize("user:manage"), updateMember);
router.delete("/:id", authorize("user:manage"), deleteMember);

module.exports = router;
