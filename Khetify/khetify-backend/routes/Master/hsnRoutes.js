const express = require("express");
const router = express.Router();
const auth = require("../../middlewares/authMiddlewares");
const { getGstByHsn, searchHsnCodes } = require("../../controller/Master/hsnGstController");

// GST rate master. Read-only.
// /search is declared FIRST: "/:code" would otherwise capture the literal word
// "search" as a code and the autocomplete would 400 on every keystroke.
router.get("/search", auth, searchHsnCodes);
router.get("/:code", auth, getGstByHsn);

module.exports = router;