import { measurementEditState, editMeasurementPayload } from '../admin/measurementEdit.js';

export function hydrateCompanyVariants(variants) {
  return Array.isArray(variants) ? variants.map(v => ({ ...v, ...measurementEditState(v), measurements: v.measurements || v.dimensions ? { ...(v.measurements ?? v.dimensions) } : undefined })) : [];
}

export function serializeCompanyVariants(variants) {
  return variants.map(v => {
    const { measurements, dimensions, _measurementBaseline, _measurementCleared, _variantBaseline, ...rest } = v;
    return { ...rest, ...editMeasurementPayload(v) };
  });
}
