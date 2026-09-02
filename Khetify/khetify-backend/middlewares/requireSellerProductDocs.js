const SellerDocument = require("../model/PC/SellerDocument");

/**
 * Gate: My Products needs three business documents ON FILE.
 *
 * Deliberately NOT an approval or a subscription gate — /api/seller/my-products
 * stays free of requireApprovedSeller, loadSubscription and requireFeature (see
 * routes/Seller/sellerMyProductRoutes.js). A seller no company has approved and
 * who pays for nothing still gets this module the moment their paperwork is up.
 * This checks paperwork and nothing else.
 *
 * PRESENCE, NOT STATUS. SellerDocument.status defaults to "pending" and there
 * is no admin verification screen yet, so nothing is ever "verified". Gating on
 * status would block every seller forever and make the feature dead on arrival.
 * So the test is only: a row of that docType exists and carries a fileUrl.
 *
 * The frontend renders its lock card from the `missing` array below rather than
 * recomputing it, so the two can never disagree about which document is absent.
 */
const REQUIRED_DOC_TYPES = ["gst", "pan", "agriculture"];

module.exports = async function requireSellerProductDocs(req, res, next) {
  try {
    if (!req.user?.sellerId) {
      return res.status(403).json({ success: false, message: "Seller access only" });
    }

    // One query, owner-scoped. `fileUrl` must be a non-empty string: a row can
    // exist with only a fileKey, and an upload that never produced a URL is not
    // a document the seller can be said to have provided.
    const present = await SellerDocument.distinct("docType", {
      sellerId: req.user.sellerId,
      docType: { $in: REQUIRED_DOC_TYPES },
      fileUrl: { $exists: true, $nin: [null, ""] },
    });

    const have = new Set(present.map(String));
    const missing = REQUIRED_DOC_TYPES.filter((t) => !have.has(t));

    if (missing.length) {
      return res.status(403).json({
        success: false,
        code: "DOCS_REQUIRED",
        missing,
        message:
          "Upload your GST certificate, PAN card and Agriculture certificate in your profile to manage My Products.",
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports.REQUIRED_DOC_TYPES = REQUIRED_DOC_TYPES;
