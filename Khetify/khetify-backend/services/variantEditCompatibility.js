const { isDeepStrictEqual: equal } = require('util');
const mongoose = require('mongoose');
const cleanup = require('../middlewares/productUploadCleanup');
const plans = new WeakMap();
const plain = value => JSON.parse(JSON.stringify(value));
const representation = row => Object.fromEntries(['measurements', 'dimensions']
  .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));

// Compatibility is opt-in through a baseline, but the baseline is verified
// against the authorized database record. It never authorizes a new identity.
function prepare(kind) {
  return async (req, res, next) => {
    try {
      let rows = req.body.variants;
      if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { return next(); } }
      if (!Array.isArray(rows) || !rows.some(row => row?._measurementEdit)) return next();
      const id = req.params.productId || req.params.id;
      if (!mongoose.isValidObjectId(id)) throw new Error('Invalid product identity');
      const Model = kind === 'admin' ? require('../model/Admin/AdminProduct') : require('../model/Company/productModel');
      const scope = kind === 'seller' ? { ownerType: 'seller', sellerId: req.user.sellerId }
        : kind === 'company' ? { companyId: req.user.companyId || req.user.id } : {};
      const filter = { _id: new mongoose.Types.ObjectId(id), ...scope };
      const stored = await Model.findOne(filter).lean();
      if (!stored) throw new Error('Product not found or not editable by this owner');
      const originals = stored.variants || [];

      const seen = new Set();
      const matches = rows.map(row => {
        if (!row?._id && !row?._measurementEdit) {
          delete row.dimensions;
          return { index: -1, mode: 'new' };
        }
        const key = String(row?._id || '');
        const index = originals.findIndex(v => String(v._id) === key);
        if (index < 0 || seen.has(key) || originals.filter(v => String(v._id) === key).length !== 1) throw new Error('Variant identity is missing, duplicated or mismatched');
        seen.add(key);
        const original = originals[index];
        const edit = row._measurementEdit;
        if (!edit || !equal(edit.baseline, plain(representation(original)))) throw new Error('Variant measurements changed; reload before editing');
        // Company GET uses hydrated subdocuments; Admin/Seller GETs use lean rows.
        const loadedShape = kind === 'company'
          ? Model.hydrate(stored).variants[index].toObject({ flattenMaps: true }) : original;
        if (edit.variantBaseline && !equal(edit.variantBaseline, plain(loadedShape))) {
          throw new Error('Variant data changed; reload before editing');
        }
        if (!['preserve', 'replace', 'clear'].includes(edit.mode)) throw new Error('Invalid measurement edit mode');
        if (edit.mode === 'preserve' && !equal(representation(row), plain(representation(original)))) {
          if (!Object.hasOwn(row, 'measurements')) throw new Error('Changed measurements must be explicit');
          edit.mode = 'replace';
        }
        if (edit.mode === 'preserve') {
          delete row.measurements;
        } else if (edit.mode === 'replace') {
          if (!Object.hasOwn(row, 'measurements')) throw new Error('Replacement measurements are required');
        } else if (Object.hasOwn(row, 'measurements')) throw new Error('Clear must not contain replacement measurements');
        delete row.dimensions;
        delete row._measurementEdit;
        return { index, mode: edit.mode };
      });
      plans.set(req, { stored, matches, scope, Model });
      req.body.variants = rows;
      next();
    } catch (error) {
      await cleanup.rollback(req);
      res.status(409).json({ success: false, message: error.message });
    }
  };
}

async function update(req, body) {
  const plan = plans.get(req);
  if (!plan) return null;
  const { stored, matches, scope, Model } = plan;
  const { variants, ...fields } = body;
  if (!Array.isArray(variants) || variants.length !== matches.length) {
    await cleanup.rollback(req);
    throw Object.assign(new Error('Variant structure changed during edit'), { status: 409 });
  }
  // Validate only submitted fields; never cast a historical variant back through
  // the current schema. New subdocuments get the normal schema defaults and IDs.
  let nextVariants, castFields;
  try {
    const allowedFields = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
      value !== undefined && !['_id', 'companyId', 'sellerId', 'ownerType'].includes(key) &&
      (Model.schema.path(key) || Model.schema.nested[key])));
    castFields = await Model.validate(allowedFields, Object.keys(allowedFields));
    nextVariants = await Promise.all(variants.map(async (row, i) => {
      const { index, mode } = matches[i];
      const original = index < 0 ? null : stored.variants[index];
      const input = { ...row };
      delete input._id;
      delete input.dimensions;
      if (original) {
        delete input.stock;
        if (!Object.hasOwn(input, 'label')) input.label = original.label;
      }
      const document = new Model({ variants: [input] });
      const variant = document.variants[0];
      await variant.validate();
      const cast = variant.toObject({ flattenMaps: true });
      if (!original) return cast;
      const result = { ...original };
      for (const key of Object.keys(row)) {
        if (['_id', 'stock', 'measurements', 'dimensions'].includes(key)) continue;
        if (!Model.schema.path('variants').schema.path(key)) continue;
        if (key === 'image' && Array.isArray(row.images) && equal(row.images, original.images) &&
          row.image === (row.images[0] || '')) continue;
        if (row[key] !== undefined) result[key] = cast[key];
      }
      if (mode === 'replace') result.measurements = cast.measurements;
      if (mode === 'clear') {
        delete result.measurements;
        delete result.dimensions;
      }
      return result;
    }));
  } catch (error) {
    // No database write has started: every local validation/cast rejection is safe to roll back.
    await cleanup.rollback(req);
    throw error;
  }
  const retained = matches.filter(match => match.index >= 0).map(match => stored.variants[match.index]);
  const query = { _id: stored._id, ...scope, $expr: { $and: retained.map(original => ({
    $eq: [{ $filter: { input: '$variants', as: 'v', cond: { $eq: ['$$v._id', { $literal: original._id }] } } },
      { $literal: [original] }]
  })) } };
  // Pipeline values have already been cast and validated above. Literal values
  // prevent user strings from becoming expressions. Keep variants concurrently
  // added since preparation; only IDs present in our read can be removed.
  const $set = Object.fromEntries(Object.entries(castFields).map(([key, value]) => [key, { $literal: value }]));
  $set.variants = { $concatArrays: [{ $literal: nextVariants }, { $filter: {
    input: '$variants', as: 'v', cond: { $not: [{ $in: ['$$v._id', { $literal: stored.variants.map(v => v._id) }] }] }
  } }] };
  const saved = await Model.findOneAndUpdate(query, [{ $set }], { new: true, updatePipeline: true });
  if (!saved) {
    await cleanup.rollback(req);
    throw Object.assign(new Error('Variant data changed; reload before saving'), { status: 409 });
  }
  return saved;
}

module.exports = { prepare, update, hasPlan: req => plans.has(req) };
