import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measurementEditState, editMeasurementError, editMeasurementPayload } from './measurementEdit.js';
import { hydrateCompanyVariants, serializeCompanyVariants } from '../Company/companyVariantMeasurements.js';
import { hydrateSellerVariant, sellerVariantPayload } from '../seller/sellerVariantRows.js';

const shapes = [{}, { measurements: null }, { measurements: { length: 2 } }, { dimensions: { length: 2 } },
  { measurements: { unit: 'Pieces' }, dimensions: { unitValue: 2 } }];
test('company and seller helpers preserve historical representation without validation or normalization', () => {
  for (const shape of shapes) {
    const original = { _id: '507f1f77bcf86cd799439011', label: 'Red', ...shape };
    const company = hydrateCompanyVariants([original])[0];
    const seller = hydrateSellerVariant(original);
    for (const row of [company, seller]) assert.equal(editMeasurementError(row), null);
    for (const payload of [serializeCompanyVariants([company])[0], sellerVariantPayload(seller, () => 0)]) {
      assert.deepEqual(payload._measurementEdit, { baseline: shape, mode: 'preserve', variantBaseline: original });
      for (const key of ['measurements', 'dimensions']) {
        assert.equal(Object.hasOwn(payload, key), Object.hasOwn(shape, key));
        assert.deepEqual(payload[key], shape[key]);
      }
    }
  }
});
test('changed incomplete measurements fail while original snapshot remains intact', () => {
  const original = { _id: 'id', measurements: { length: 2 } };
  const row = { ...measurementEditState(original), measurements: { length: 3 } };
  assert(editMeasurementError(row));
  assert.equal(editMeasurementPayload(row)._measurementEdit.mode, 'replace');
  assert.deepEqual(row._measurementBaseline, { measurements: { length: 2 } });
});
test('explicit clear differs from unchanged null and absence', () => {
  const row = { ...measurementEditState({ _id: 'id', measurements: null }), measurements: undefined };
  assert.equal(editMeasurementPayload(row)._measurementEdit.mode, 'preserve');
  assert.equal(editMeasurementPayload({ ...row, _measurementCleared: true })._measurementEdit.mode, 'clear');
});
test('new variants still reject incomplete measurements and do not request compatibility', () => {
  const row = { measurements: { length: 2 } };
  assert(editMeasurementError(row));
  assert.equal(Object.hasOwn(editMeasurementPayload(row), '_measurementEdit'), false);
});
