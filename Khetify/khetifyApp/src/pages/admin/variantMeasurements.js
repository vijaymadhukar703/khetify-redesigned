const numericFields = ['unitValue', 'length', 'width', 'height', 'weight'];
const labels = { unitValue: 'Net Weight / Net Volume / Quantity per Pack', length: 'Length', width: 'Width', height: 'Height', weight: 'Shipping Weight (Gross)' };

export function measurementError(value) {
  if (!value) return null;
  if (!value.packagingType?.trim()) return 'Please enter Packaging Type.';
  if (!value.unit) return 'Please select Unit of Measurement.';
  for (const key of numericFields) {
    if (!Number.isFinite(Number(value[key])) || !(Number(value[key]) > 0)) return labels[key] + ' must be greater than zero.';
  }
  if (['Pieces', 'Packets'].includes(value.unit) && !Number.isInteger(Number(value.unitValue))) return 'Quantity per Pack must be a whole number.';
  if (!value.dimensionUnit || !value.weightUnit) return 'Please select dimension and shipping weight units.';
  return null;
}

export function measurementPayload(value) {
  return value ? { measurements: { ...value, ...Object.fromEntries(numericFields.map(key => [key, Number(value[key])])) } } : {};
}

