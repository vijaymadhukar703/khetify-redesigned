import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopVariantSpecs } from './shopVariantSpecs.js';
const m = { packagingType: 'Bottle', unit: 'Liters', unitValue: 2, length: 10, width: 8, height: 20, dimensionUnit: 'cm', weight: 2.5, weightUnit: 'kg' };
const a = { id: 'A', measurements: m };
const b = { id: 'B', measurements: { ...m, packagingType: 'Bag', unit: 'Kilograms', unitValue: 5, length: 30, width: 20, height: 10, weight: 6 } };
test('selection A -> B -> legacy -> A immediately produces independent measurement rows', () => {
  const expectedA = [['Packaging Type', 'Bottle'], ['Unit of Measurement', 'Liters (L)'], ['Net Volume', '2 L'], ['Product Dimensions', '10 \u00d7 8 \u00d7 20 cm'], ['Shipping Weight (Gross)', '2.5 kg']];
  assert.deepEqual(shopVariantSpecs(a), expectedA);
  assert.deepEqual(shopVariantSpecs(b), [['Packaging Type', 'Bag'], ['Unit of Measurement', 'Kilograms (kg)'], ['Net Weight', '5 kg'], ['Product Dimensions', '30 \u00d7 20 \u00d7 10 cm'], ['Shipping Weight (Gross)', '6 kg']]);
  assert.deepEqual(shopVariantSpecs({ id: 'legacy' }), []);
  assert.deepEqual(shopVariantSpecs(a), expectedA);
  assert.deepEqual(shopVariantSpecs(null), []);
});
test('every supported unit has the correct value label and suffix', () => {
  for (const [unit, label, suffix] of [['Kilograms', 'Net Weight', 'kg'], ['Grams', 'Net Weight', 'g'], ['Metric Ton', 'Net Weight', 'MT'], ['Liters', 'Net Volume', 'L'], ['Milliliters', 'Net Volume', 'ml'], ['Pieces', 'Quantity per Pack', 'Pcs'], ['Packets', 'Quantity per Pack', 'Pkt']]) {
    assert.deepEqual(shopVariantSpecs({ measurements: { unit, unitValue: 3 } })[1], [label, '3 ' + suffix]);
  }
});
test('partial legacy measurements never invent values, units or product fallbacks', () => {
  const legacy = { measurements: { packagingType: 'undefined', unit: 'bad', unitValue: 0, length: 3, width: 2, height: undefined, dimensionUnit: 'cm', weight: -1, weightUnit: 'kg' } };
  assert.deepEqual(shopVariantSpecs(legacy), []);
  assert.deepEqual(shopVariantSpecs({ measurements: { weight: 5 } }), []);
  assert.deepEqual(shopVariantSpecs({ measurements: { unitValue: 5 } }), []);
  for (const invalid of ['', null, undefined, 0, -1, Infinity, NaN, true]) {
    const rows = shopVariantSpecs({ measurements: { ...m, unitValue: invalid, length: invalid, weight: invalid } });
    assert.deepEqual(rows, [['Packaging Type', 'Bottle'], ['Unit of Measurement', 'Liters (L)']]);
  }
});
test('count value must be whole, and Hindi labels preserve saved values', () => {
  assert.deepEqual(shopVariantSpecs({ measurements: { unit: 'Pieces', unitValue: 1.5 } }), [['Unit of Measurement', 'Pieces (Pcs)']]);
  assert.equal(shopVariantSpecs(a, 'hi')[2][1], '2 L');
  assert.equal(shopVariantSpecs(a, 'hi')[2][0], '\u0936\u0941\u0926\u094d\u0927 \u092e\u093e\u0924\u094d\u0930\u093e');
});

test('only saved packaging/unit/value appear when dimensions and shipping are absent', () => {
  assert.deepEqual(shopVariantSpecs({ measurements: { packagingType: 'HDPE Bag', unit: 'Kilograms', unitValue: 5 } }), [['Packaging Type', 'HDPE Bag'], ['Unit of Measurement', 'Kilograms (kg)'], ['Net Weight', '5 kg']]);
});
