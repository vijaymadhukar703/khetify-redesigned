import { measurementError, measurementPayload } from './variantMeasurements.js';

const copy = value => JSON.parse(JSON.stringify(value));
const representation = row => Object.fromEntries(['measurements', 'dimensions']
  .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));

export function measurementEditState(row) {
  return row._id ? { _id: row._id, _measurementBaseline: copy(representation(row)), _variantBaseline: copy(row) } : {};
}
const originalValue = row => row._measurementBaseline?.measurements ?? row._measurementBaseline?.dimensions;
const unchanged = row => !row._measurementCleared && Object.hasOwn(row, '_measurementBaseline') &&
  JSON.stringify(row.measurements ?? null) === JSON.stringify(originalValue(row) ?? null);

export function editMeasurementError(row) {
  return unchanged(row) ? null : measurementError(row.measurements);
}

export function editMeasurementPayload(row) {
  if (!Object.hasOwn(row, '_measurementBaseline')) return measurementPayload(row.measurements);
  const mode = unchanged(row) ? 'preserve' : row.measurements === undefined ? 'clear' : 'replace';
  return {
    _id: row._id,
    _measurementEdit: { baseline: copy(row._measurementBaseline), mode, ...(row._variantBaseline ? { variantBaseline: copy(row._variantBaseline) } : {}) },
    ...(mode === 'preserve' ? copy(row._measurementBaseline) : mode === 'replace' ? measurementPayload(row.measurements) : {}),
  };
}
