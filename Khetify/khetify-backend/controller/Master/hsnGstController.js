const { lookupHsn, searchHsn } = require("../../services/hsnGstService");

/**
 * GET /api/hsn/:code
 *
 * Read-only master lookup used by the Company Upload Product page. Authenticated
 * (any signed-in company user may read the GST master) but deliberately carries
 * no capability check and no company scope: the GST rate of an HSN code is
 * public statutory data, identical for everyone.
 *
 * The HTTP status reflects the outcome so the client can branch without parsing
 * prose: 200 when a rate is resolved (single or multiple), 400 for a malformed
 * code, 404 when the master has nothing.
 */
exports.getGstByHsn = async (req, res) => {
  try {
    const result = await lookupHsn(req.params.code);

    if (result.status === "invalid") {
      return res.status(400).json({ success: false, ...result });
    }
    if (result.status === "not_found") {
      return res.status(404).json({ success: false, ...result });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("getGstByHsn error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/hsn/search?q=310&limit=20
 *
 * Autocomplete feed for the HSN field. Same read-only, unscoped access as the
 * lookup above. Returns 200 with an empty list for a too-short query rather than
 * an error, because a partially typed code is a normal state of the input, not a
 * mistake.
 */
exports.searchHsnCodes = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const result = await searchHsn(req.query.q, { limit });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("searchHsnCodes error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};