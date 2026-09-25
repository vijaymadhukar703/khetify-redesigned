const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const Company = require('../model/Company/Company');
const Product = require('../model/Company/productModel');
const app = express();
app.use(express.json());
app.use('/api/product', require('../routes/Company/productRoutes'));
let companyId, authorization;
beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  await Company.collection.insertOne({ _id: companyId, companyInfo: { companyName: 'Variant Test Company' } });
  authorization = 'Bearer ' + jwt.sign({ id: String(companyId), companyId: String(companyId), role: 'company_admin' }, process.env.JWT_SECRET);
});
const measurements = { packagingType: 'HDPE Bag', unit: 'Kilograms', unitValue: 5, length: 10, width: 12, height: 14, dimensionUnit: 'cm', weight: 6, weightUnit: 'kg' };
const variants = () => [
  { label: 'Red', attributes: { Color: 'Red' }, sku: 'RED', mrp: 100, stock: 4, images: ['uploads/products/red.jpg'], image: 'uploads/products/red.jpg', measurements },
  { label: 'Blue', attributes: { Color: 'Blue' }, sku: 'BLUE', mrp: 200, stock: 7, images: ['uploads/products/blue.jpg'], image: 'uploads/products/blue.jpg', measurements: { ...measurements, packagingType: 'Bottle', unit: 'Liters', unitValue: 2, length: 20, weight: 3 } },
];
const body = () => ({ companyId: String(companyId), productName: 'Company variant measurements', packagingType: 'Carton Box', unit: 'Pieces', unitValue: 99, length: 40, width: 30, height: 20, weight: 50, hsnCode: '1234', manufactureLicenseNo: 'LIC123', shelfLifeDays: 365, minimumOrderQuantity: 5, monthlyProductionCapacity: 100, bulkPackaging: { type: 'Carton', unitsPerPack: 10 }, variants: variants() });
const multipart = (method, url, value) => {
  let req = request(app)[method](url).set('Authorization', authorization);
  for (const [key, field] of Object.entries(value)) req = req.field(key, typeof field === 'object' ? JSON.stringify(field) : String(field));
  return req;
};
function editPayload(rows) {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../khetifyApp/src/pages/Company/companyVariantMeasurements.js')).href;
  const script = 'import fs from "node:fs"; import { hydrateCompanyVariants, serializeCompanyVariants } from ' + JSON.stringify(moduleUrl) + '; console.log(JSON.stringify(serializeCompanyVariants(hydrateCompanyVariants(JSON.parse(fs.readFileSync(0,"utf8"))))));';
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { input: JSON.stringify(rows), encoding: 'utf8' }));
}
test('two distinct variants: multipart create -> edit hydration -> save -> reopen', async () => {
  const created = await multipart('post', '/api/product/create', body());
  expect(created.status).toBe(201);
  const id = created.body.data._id;
  const read = await request(app).get('/api/product/' + id);
  expect(read.status).toBe(200);
  expect(read.body.data.variants.map(v => v.measurements.unitValue)).toEqual([5, 2]);
  const payload = editPayload(read.body.data.variants);
  payload[0].measurements.unitValue = 8;
  payload[0].measurements.height = 18;
  const saved = await multipart('put', '/api/product/' + id, { variants: payload });
  expect(saved.status).toBe(200);
  const reopened = await request(app).get('/api/product/' + id);
  const restored = editPayload(reopened.body.data.variants);
  expect(restored[0].measurements.unitValue).toBe(8);
  expect(restored[0].measurements.height).toBe(18);
  expect(restored[1].measurements).toEqual(variants()[1].measurements);
  for (let i = 0; i < 2; i++) {
    expect(restored[i]._id).toBe(payload[i]._id);
    for (const key of ['sku', 'mrp', 'stock', 'images', 'attributes']) expect(restored[i][key]).toEqual(variants()[i][key]);
  }
  const stored = await Product.findById(id).lean();
  expect(stored.unitValue).toBe(99);
  expect(stored.length).toBe(40);
  expect(stored.minimumOrderQuantity).toBe(5);
  expect(stored.monthlyProductionCapacity).toBe(100);
});
test('legacy variant with default single variantType survives Company edit JSON payload', async () => {
  const product = await Product.create({ companyId, productName: 'Legacy', variants: [{ label: 'Old', stock: 3, mrp: 12, image: 'uploads/products/old.jpg' }] });
  expect(product.variantType).toBe('single');
  const read = await request(app).get('/api/product/' + product._id);
  const saved = await multipart('put', '/api/product/' + product._id, { variants: editPayload(read.body.data.variants) });
  expect(saved.status).toBe(200);
  expect(saved.body.data.variants).toHaveLength(1);
  expect(saved.body.data.variants[0].measurements).toBeUndefined();
  expect(saved.body.data.variants[0].stock).toBe(3);
});
test.each([{}, { ...measurements, length: 0 }, { ...measurements, weight: -1 }, { ...measurements, width: undefined }, { ...measurements, unit: 'Pieces', unitValue: 1.5 }])('create and edit reject invalid measurements: %j', async bad => {
  const rows = [{ label: 'Red', measurements: bad }];
  const added = await multipart('post', '/api/product/create', { ...body(), variants: rows });
  expect(added.status).toBe(400);
  expect(added.body.message).toContain('Variant Red:');
  const product = await Product.create({ companyId, productName: 'Untouched', variants: variants() });
  const updated = await multipart('put', '/api/product/' + product._id, { variants: rows });
  expect(updated.status).toBe(400);
  expect((await Product.findById(product._id)).variants[0].measurements.unitValue).toBe(5);
});

function fullEditPayload(product) {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../khetifyApp/src/pages/Company/companyProductEditPayload.js')).href;
  const script = 'import fs from "node:fs"; import { hydrateCompanyEditProduct, companyProductEditPayload } from ' + JSON.stringify(moduleUrl) + '; const product = JSON.parse(fs.readFileSync(0,"utf8")); const state = hydrateCompanyEditProduct(product); const data = companyProductEditPayload(state); console.log(JSON.stringify({state, fields: Object.fromEntries(data)}));';
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { input: JSON.stringify(product), encoding: 'utf8' }));
}

test('full fetched Company edit payload preserves ownership, hidden fields, images and both variant measurements', async () => {
  const product = await Product.create({ ...body(), sellerId: null, trackSerial: false, mrp: 0, availableStock: 0, skuNumber: 'KEEP-SKU', productImages: ['uploads/products/a.jpg', 'uploads/products/b.jpg'] });
  const url = '/api/product/' + product._id;
  const before = JSON.parse(JSON.stringify(await Product.findById(product._id).lean()));
  const fetched = (await request(app).get(url)).body.data;
  expect(typeof fetched.companyId).toBe('object');
  expect(fetched.sellerId).toBeNull();
  const { state, fields } = fullEditPayload(fetched);
  expect(state.product_code).toBe(fetched.product_code);
  expect(state.skuNumber).toBe('KEEP-SKU');
  for (const key of ['sellerId', 'companyId', 'ownerType', 'skuNumber', 'trackSerial', 'bulkPackaging', 'shelfLifeDays', 'deletedAt', 'variantType', 'product_code']) expect(fields).not.toHaveProperty(key);
  expect(fields.mrp).toBe('0');
  expect(fields.availableStock).toBe('0');
  expect(Object.values(fields)).not.toContain('[object Object]');
  const rows = JSON.parse(fields.variants);
  rows[0].measurements.unitValue = 8;
  fields.variants = JSON.stringify(rows);
  let req = multipart('put', url, fields);
  for (const image of fetched.productImages) req = req.field('kept_images', image);
  const saved = await req;
  expect(saved.status).toBe(200);
  const after = JSON.parse(JSON.stringify(await Product.findById(product._id).lean()));
  const { updatedAt: oldTime, ...expected } = before;
  const { updatedAt: newTime, ...actual } = after;
  expected.variants[0].measurements.unitValue = 8;
  expect(actual).toEqual(expected);
  const reopened = fullEditPayload((await request(app).get(url)).body.data).state;
  expect(reopened.variants[0].measurements.unitValue).toBe(8);
  expect(reopened.variants[1].measurements).toEqual(variants()[1].measurements);
});

test.each([undefined, '', null, '507f1f77bcf86cd799439011'])('legacy edit sellerId %j cannot change Company ownership', async sellerId => {
  const product = await Product.create({ companyId, productName: 'Owner preserved', variants: variants() });
  const payload = { companyId: '507f1f77bcf86cd799439012', ownerType: 'seller', mrp: 25 };
  if (sellerId !== undefined) payload.sellerId = sellerId;
  const result = await request(app).put('/api/product/' + product._id).set('Authorization', authorization).send(payload);
  expect(result.status).toBe(200);
  expect(result.body.data.companyId).toBe(String(companyId));
  expect(result.body.data.ownerType).toBe('company');
  expect(result.body.data.sellerId).toBeNull();
  expect(result.body.data.mrp).toBe(25);
  expect(result.body.data.variants[0].measurements).toEqual(measurements);
});
