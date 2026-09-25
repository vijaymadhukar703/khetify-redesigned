const SellerCategory = require("../../model/Master/SellerCategory");

/**
 * SELLER PRODUCT CATEGORY MASTER — read + append.
 *
 * Shared across sellers on purpose: a category one seller adds becomes an option
 * for everyone after it. There is no delete and no edit here; removing a chip in
 * the onboarding form only drops the seller's own selection, never the row.
 */

const MIN_LEN = 2;
const MAX_LEN = 40;
// Letters, digits, spaces and hyphens only. Everything else (@, #, /, commas —
// which would also break a comma-joined display) is rejected, because this list
// is written by sellers and read by every seller after them.
const NAME_RE = /^[A-Za-z0-9 -]+$/;

/**
 * GET /api/seller/categories
 *
 * Every active category, sorted by name — the dropdown feed for onboarding
 * step 1. Authenticated (any signed-in seller), with no seller scope: the master
 * is common to all of them. "Other" is not returned; it is a UI-only option.
 */
exports.listSellerCategories = async (req, res) => {
  try {
    const categories = await SellerCategory.find({ isActive: true })
      .select("name")
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error("listSellerCategories error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/seller/categories  { name }
 *
 * Adds a category typed through the form's "Other" box.
 *
 * A name that already exists is NOT an error and does NOT create a second row —
 * the existing category is returned so the client can just select it. That is
 * what makes "micronutrient" typed by a second seller resolve to the
 * "Micronutrient" the first one added, instead of splitting the list in two.
 */
exports.createSellerCategory = async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Category name is required" });
    if (name.length < MIN_LEN || name.length > MAX_LEN) {
      return res.status(400).json({ success: false, message: `Category name must be ${MIN_LEN}-${MAX_LEN} characters` });
    }
    if (!NAME_RE.test(name)) {
      return res.status(400).json({ success: false, message: "Use only letters, digits, spaces and hyphens" });
    }

    const nameKey = name.toLowerCase();

    const existing = await SellerCategory.findOne({ nameKey }).select("name isActive").lean();
    if (existing) {
      // Reached both by a deliberate duplicate and by the race below.
      return res.json({ success: true, message: "Category already exists", data: { _id: existing._id, name: existing.name } });
    }

    try {
      const created = await SellerCategory.create({
        name,
        nameKey,
        isSeeded: false,
        createdBySellerId: req.user.sellerId || null,
      });
      return res.status(201).json({ success: true, message: "Category added", data: { _id: created._id, name: created.name } });
    } catch (err) {
      // Two sellers typing the same new category at the same moment: the unique
      // index rejects the loser, which then reads the winner's row and returns
      // it — same answer either way.
      if (err?.code === 11000) {
        const winner = await SellerCategory.findOne({ nameKey }).select("name").lean();
        if (winner) return res.json({ success: true, message: "Category already exists", data: { _id: winner._id, name: winner.name } });
      }
      throw err;
    }
  } catch (error) {
    console.error("createSellerCategory error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
