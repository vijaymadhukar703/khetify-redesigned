const UNITS = {
  Kilograms: ['netWeight', 'kg'], Grams: ['netWeight', 'g'], 'Metric Ton': ['netWeight', 'MT'],
  Liters: ['netVolume', 'L'], Milliliters: ['netVolume', 'ml'],
  Pieces: ['quantity', 'Pcs'], Packets: ['quantity', 'Pkt'],
};
const LABELS = {
  en: { packaging: 'Packaging Type', unit: 'Unit of Measurement', netWeight: 'Net Weight', netVolume: 'Net Volume', quantity: 'Quantity per Pack', dimensions: 'Product Dimensions', shipping: 'Shipping Weight (Gross)' },
  hi: { packaging: '\u092a\u0948\u0915\u0947\u091c\u093f\u0902\u0917 \u092a\u094d\u0930\u0915\u093e\u0930', unit: '\u092e\u093e\u092a \u0915\u0940 \u0907\u0915\u093e\u0908', netWeight: '\u0936\u0941\u0926\u094d\u0927 \u0935\u091c\u0928', netVolume: '\u0936\u0941\u0926\u094d\u0927 \u092e\u093e\u0924\u094d\u0930\u093e', quantity: '\u092a\u094d\u0930\u0924\u093f \u092a\u0948\u0915 \u0938\u0902\u0916\u094d\u092f\u093e', dimensions: '\u0909\u0924\u094d\u092a\u093e\u0926 \u0915\u0947 \u0906\u092f\u093e\u092e', shipping: '\u0936\u093f\u092a\u093f\u0902\u0917 \u0935\u091c\u0928 (\u0938\u0915\u0932)' },
};
const positive = value => (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) && Number(value) > 0;
const text = value => typeof value === 'string' && !['', '0', 'undefined', 'null'].includes(value.trim().toLowerCase()) ? value.trim() : null;

// Only the selected variant supplies these rows. Missing legacy data stays absent.
export function shopVariantSpecs(variant, lang = 'en') {
  const m = variant?.measurements;
  if (!m) return [];
  const labels = LABELS[lang] || LABELS.en;
  const rows = [];
  const packaging = text(m.packagingType);
  if (packaging) rows.push([labels.packaging, packaging]);
  const unit = text(m.unit);
  const unitMeta = Object.hasOwn(UNITS, unit) ? UNITS[unit] : null;
  if (unitMeta) {
    rows.push([labels.unit, unit + ' (' + unitMeta[1] + ')']);
    if (positive(m.unitValue) && (unitMeta[0] !== 'quantity' || Number.isInteger(Number(m.unitValue)))) {
      rows.push([labels[unitMeta[0]], Number(m.unitValue) + ' ' + unitMeta[1]]);
    }
  }
  if ([m.length, m.width, m.height].every(positive) && ['mm', 'cm', 'm', 'inch', 'ft'].includes(m.dimensionUnit)) {
    rows.push([labels.dimensions, [m.length, m.width, m.height].map(Number).join(' \u00d7 ') + ' ' + m.dimensionUnit]);
  }
  if (positive(m.weight) && ['g', 'kg', 'MT'].includes(m.weightUnit)) {
    rows.push([labels.shipping, Number(m.weight) + ' ' + m.weightUnit]);
  }
  return rows;
}
