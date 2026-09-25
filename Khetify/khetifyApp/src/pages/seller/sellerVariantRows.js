import { measurementPayload } from '../admin/variantMeasurements.js';

export function hydrateSellerVariant(v) {
  const measurements = v.measurements ?? v.dimensions;
  return {
    label: v.label,
    attrMap: v.attributes || {},
    sku: v.sku || '',
    mrp: v.mrp ?? '',
    measurements: measurements ? { ...measurements } : undefined,
    keptImages: v.images?.length ? [...v.images] : (v.image ? [v.image] : []),
    newFiles: [],
    newPreviews: [],
  };
}

export function sellerVariantPayload(row, nextImageIndex) {
  return {
    label: row.label,
    attributes: row.attrMap,
    sku: row.sku,
    mrp: String(row.mrp ?? '').trim() === '' ? undefined : Number(row.mrp),
    ...measurementPayload(row.measurements),
    images: row.keptImages,
    imageIndexes: row.newFiles.map(nextImageIndex),
  };
}
