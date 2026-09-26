const { rollback } = require("../middlewares/productUploadCleanup");
const { z } = require('zod');
const measurements = require('./variantMeasurements');
// Validate only the new measurement block; preserve all existing company fields.
const variantsSchema = z.array(z.object({ measurements: measurements.optional() }).passthrough());
module.exports = async function validateCompanyVariantMeasurements(req, res, next) {
  let variants = req.body.variants;
  if (variants === undefined) return next();
  if (typeof variants === 'string') {
    try { variants = JSON.parse(variants); }
    catch {
      // Legacy edit clients sent [object Object]; the controller preserves old rows.
      if (variants.includes('[object Object]')) return next();
      await rollback(req);
      return res.status(400).json({ success: false, message: 'Variants must be valid JSON' });
    }
  }
  const parsed = variantsSchema.safeParse(variants);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = Array.isArray(variants) ? variants[issue.path[0]] : null;
    await rollback(req);
    return res.status(400).json({ success: false, message: 'Variant ' + (row?.label || Number(issue.path[0]) + 1) + ': ' + issue.message });
  }
  req.body.variants = parsed.data;
  return next();
};
