import { measurementPayload } from '../admin/variantMeasurements.js';

export function hydrateCompanyVariants(variants) {
  return Array.isArray(variants) ? variants.map(v => ({ ...v, measurements: v.measurements || v.dimensions ? { ...(v.measurements ?? v.dimensions) } : undefined })) : [];
}

export function serializeCompanyVariants(variants) {
  return variants.map(v => {
    const { measurements, dimensions, ...rest } = v;
    void dimensions; // Legacy data is saved using the canonical measurements field.
    return { ...rest, ...measurementPayload(measurements) };
  });
}
