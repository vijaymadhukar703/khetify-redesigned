import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { measurementError, measurementPayload } from './variantMeasurements.js';
const require = createRequire(import.meta.url);
const result = await build({ entryPoints: [new URL('./VariantMeasurements.jsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
const mod = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
const Panel = mod.exports.default;
const units = [
  { value: 'Kilograms', label: 'Kilograms (kg)', short: 'kg', kind: 'weight' },
  { value: 'Liters', label: 'Liters (L)', short: 'L', kind: 'volume' },
  { value: 'Pieces', label: 'Pieces (Pcs)', short: 'Pcs', kind: 'count' },
];
const valid = { packagingType: 'Bag', unit: 'Kilograms', unitValue: '2', length: '3', width: '4', height: '5', dimensionUnit: 'cm', weight: '3', weightUnit: 'kg' };
const flatten = node => node == null ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [node];
const render = (value, onChange = () => {}) => flatten(Panel({ value, onChange, units, idPrefix: 'variant-A', ThemedSelect: 'themed-select', inputClass: 'test-input', labelClass: 'test-label', hintClass: 'test-hint' }));
test('unit value is hidden until selected; labels and suffixes follow unit', () => {
  assert.equal(render(undefined).filter(n => n.type === 'input').length, 4);
  for (const [unit, label] of [['Kilograms', 'Net Weight'], ['Liters', 'Net Volume'], ['Pieces', 'Quantity per Pack']]) {
    const nodes = render({ ...valid, unit });
    assert(nodes.includes(label));
    assert(nodes.includes(units.find(u => u.value === unit).short));
    assert.equal(nodes.filter(n => n.type === 'input').length, 5);
  }
});
test('variant switch preserves row values and payload; kind switch clears stale value', () => {
  const rows = { A: { ...valid }, B: { ...valid, unitValue: '8' } };
  const update = name => value => { rows[name] = value; };
  const a = render(rows.A, update('A'));
  a.find(n => n.type === 'input' && n.props.value === '2').props.onChange({ target: { id: 'variant-A-unitValue', value: '7' } });
  const b = render(rows.B, update('B'));
  assert(b.some(n => n.type === 'input' && n.props.value === '8'));
  assert(render(rows.A).some(n => n.type === 'input' && n.props.value === '7'));
  assert.equal(measurementPayload(rows.A).measurements.unitValue, 7);
  assert.equal(measurementPayload(rows.B).measurements.unitValue, 8);
  b.find(n => n.type === 'themed-select' && n.props.value === 'Kilograms').props.onChange('Liters');
  assert.equal(rows.B.unitValue, '');
  assert.equal(rows.A.unitValue, '7');
});
test('legacy remains optional; partial, zero, negative and fractional counts fail', () => {
  assert.equal(measurementError(undefined), null);
  assert.deepEqual(measurementPayload(undefined), {});
  assert.equal(measurementError(valid), null);
  for (const value of [{}, { ...valid, length: '' }, { ...valid, weight: 0 }, { ...valid, width: -1 }, { ...valid, unit: 'Pieces', unitValue: 1.5 }]) assert(measurementError(value));
});
