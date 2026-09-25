import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateSellerVariant, sellerVariantPayload } from './sellerVariantRows.js';
const measurements = { packagingType: 'Bottle', unit: 'Liters', unitValue: 2, length: 10, width: 8, height: 20, dimensionUnit: 'cm', weight: 2.5, weightUnit: 'kg' };
const original = { label: 'Small', attributes: { Size: 'Small' }, sku: 'SM', mrp: 150, images: ['uploads/products/small.jpg'], measurements };

test('library hydration and edit hydration preserve the actual saved fields', () => {
  const row = hydrateSellerVariant(original);
  assert.deepEqual(row.measurements, measurements);
  assert.notEqual(row.measurements, original.measurements);
  const payload = sellerVariantPayload(row, () => 0);
  assert.deepEqual(hydrateSellerVariant(payload), row);
  assert.deepEqual(payload.attributes, original.attributes);
  assert.equal(payload.sku, original.sku);
  assert.equal(payload.mrp, original.mrp);
  assert.deepEqual(payload.images, original.images);
});
test('editing and switching rows never changes the source library or another variant', () => {
  const a = hydrateSellerVariant(original);
  const b = hydrateSellerVariant({ ...original, label: 'Large' });
  a.measurements.unitValue = '5';
  a.measurements.length = '15';
  assert.equal(b.measurements.unitValue, 2);
  assert.equal(original.measurements.unitValue, 2);
  assert.equal(sellerVariantPayload(a, () => 0).measurements.length, 15);
  assert.equal(sellerVariantPayload(b, () => 0).measurements.length, 10);
});
test('legacy variants stay optional and retain single-image fallback and blank MRP', () => {
  const row = hydrateSellerVariant({ label: 'Legacy', image: 'uploads/products/legacy.jpg' });
  const payload = sellerVariantPayload(row, () => 0);
  assert.equal(Object.hasOwn(payload, 'measurements'), false);
  assert.equal(payload.mrp, undefined);
  assert.deepEqual(payload.images, ['uploads/products/legacy.jpg']);
  assert.equal(sellerVariantPayload({ ...row, mrp: '  ' }, () => 0).mrp, undefined);
});
test('new photo positions remain global across variant rows', () => {
  const a = { ...hydrateSellerVariant(original), newFiles: ['a', 'b'] };
  const b = { ...hydrateSellerVariant(original), newFiles: ['c'] };
  let index = 0;
  const payload = [a, b].map(row => sellerVariantPayload(row, () => index++));
  assert.deepEqual(payload.map(row => row.imageIndexes), [[0, 1], [2]]);
  assert.deepEqual(payload[0].images, original.images);
});

test('legacy dimensions hydrate and save under measurements without borrowing values', () => {
  const row = hydrateSellerVariant({ label: 'red', dimensions: { ...measurements, packagingType: 'HDPE Bag', unit: 'Grams', unitValue: 5 } });
  assert.equal(row.measurements.unit, 'Grams');
  assert.equal(row.measurements.unitValue, 5);
  assert.deepEqual(sellerVariantPayload(row, () => 0).measurements, row.measurements);
  assert.deepEqual(hydrateSellerVariant({ ...original, dimensions: { ...measurements, unitValue: 999 } }).measurements, measurements);
});
