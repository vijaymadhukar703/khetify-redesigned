const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const Product = require('../model/Company/productModel');
const AdminProduct = require('../model/Admin/AdminProduct');
const SellerDocument = require('../model/PC/SellerDocument');
const { createMyProductBody, updateMyProductBody } = require('../validators/sellerMyProductValidators');
const app = express();
app.use(express.json());
app.use('/api/admin/products', require('../routes/Admin/adminProductRoutes'));
app.use('/api/seller/library', require('../routes/Seller/sellerLibraryRoutes'));
app.use('/api/seller/my-products', require('../routes/Seller/sellerMyProductRoutes'));
const measurements = { packagingType: 'Bottle', unit: 'Liters', unitValue: 2, length: 10, width: 8, height: 20, dimensionUnit: 'cm', weight: 2.5, weightUnit: 'kg' };
const auth = token => ({ Authorization: 'Bearer ' + token });
const sign = payload => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
let sellerId, token, adminToken;
beforeEach(async () => {
  sellerId = new mongoose.Types.ObjectId();
  token = sign({ id: String(sellerId), sellerId: String(sellerId), principalType: 'seller', role: 'seller_admin' });
  adminToken = sign({ id: String(new mongoose.Types.ObjectId()), principalType: 'admin', role: 'super_admin' });
  await SellerDocument.create(['gst', 'pan', 'agriculture'].map(docType => ({ sellerId, docType, fileKey: docType, fileUrl: 'https://example.test/' + docType })));
});
// Execute the exact frontend hydration and payload helpers used by both seller forms.
function formRoundTrip(variants) {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../khetifyApp/src/pages/seller/sellerVariantRows.js')).href;
  const script = 'import fs from "node:fs"; import { hydrateSellerVariant, sellerVariantPayload } from ' + JSON.stringify(moduleUrl) + '; let index = 0; const rows = JSON.parse(fs.readFileSync(0, "utf8")).map(hydrateSellerVariant); console.log(JSON.stringify(rows.map(row => sellerVariantPayload(row, () => index++))));';
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { input: JSON.stringify(variants), encoding: 'utf8' }));
}

test('admin save -> library response -> seller auto-fill/payload -> save -> edit -> reload', async () => {
  const company = await Product.create({ companyId: new mongoose.Types.ObjectId(), productName: 'Company untouched', variants: [{ label: 'Original', sku: 'CO', mrp: 30 }] });
  const companyBefore = JSON.stringify(await Product.findById(company._id).lean());
  const body = { productName: 'Library dimensions', companyName: 'Agro', legalName: 'Agro Ltd', category: 'Fertilizer', shelfLifeDays: 365, unit: 'Kilograms', unitValue: 25, productImages: ['uploads/products/main.jpg'], variants: [
    { label: 'Small', attributes: { Size: 'Small' }, sku: 'SM', mrp: 150, images: ['uploads/products/small.jpg'], measurements },
    { label: 'Large', attributes: { Size: 'Large' }, sku: 'LG', mrp: 300, images: ['uploads/products/large.jpg'], measurements: { ...measurements, unit: 'Pieces', unitValue: 10, weight: 4 } },
  ] };
  const admin = await request(app).post('/api/admin/products').set(auth(adminToken)).send(body);
  expect(admin.status).toBe(201);
  const library = await request(app).get('/api/seller/library/product-details').set(auth(token)).query({ companyName: body.companyName, productName: body.productName, category: body.category });
  expect(library.status).toBe(200);
  const source = library.body.data[0];
  expect(source.variants[0].measurements).toEqual(measurements);
  const variants = formRoundTrip(source.variants);
  const added = await request(app).post('/api/seller/my-products').set(auth(token))
    .field('productName', source.productName).field('shelfLifeDays', '365').field('unit', source.unit).field('unitValue', String(source.unitValue))
    .field('kept_images', source.productImages).field('variants', JSON.stringify(variants));
  expect(added.status).toBe(201);
  const id = added.body.data._id;
  const loaded = await request(app).get('/api/seller/my-products/' + id).set(auth(token));
  expect(loaded.status).toBe(200);
  expect(loaded.body.data.variants[0].measurements).toEqual(measurements);
  expect(loaded.body.data.variants[1].measurements.unitValue).toBe(10);
  expect(loaded.body.data.unitValue).toBe(25);
  expect(loaded.body.data.productImages).toEqual(source.productImages);
  const editVariants = formRoundTrip(loaded.body.data.variants);
  editVariants[0].measurements.length = 12;
  const updated = await request(app).put('/api/seller/my-products/' + id).set(auth(token)).field('variants', JSON.stringify(editVariants));
  expect(updated.status).toBe(200);
  const reopened = await request(app).get('/api/seller/my-products/' + id).set(auth(token));
  const restored = formRoundTrip(reopened.body.data.variants);
  expect(restored[0].measurements.length).toBe(12);
  expect(restored[1].measurements).toEqual(variants[1].measurements);
  for (let i = 0; i < 2; i++) {
    expect(restored[i].sku).toBe(variants[i].sku);
    expect(restored[i].mrp).toBe(variants[i].mrp);
    expect(restored[i].images).toEqual(variants[i].images);
    expect(restored[i].attributes).toEqual(variants[i].attributes);
  }
  expect((await AdminProduct.findById(admin.body.data._id).lean()).variants[0].measurements.length).toBe(10);
  expect(JSON.stringify(await Product.findById(company._id).lean())).toBe(companyBefore);
});

test('legacy variant saves and edits without measurements', async () => {
  const variants = formRoundTrip([{ label: 'Legacy', sku: 'OLD', mrp: 12, image: 'uploads/products/old.jpg' }]);
  const added = await request(app).post('/api/seller/my-products').set(auth(token)).send({ productName: 'Legacy', shelfLifeDays: 30, variants });
  expect(added.status).toBe(201);
  const edited = await request(app).put('/api/seller/my-products/' + added.body.data._id).set(auth(token)).field('variants', JSON.stringify(formRoundTrip(added.body.data.variants)));
  expect(edited.status).toBe(200);
  expect(edited.body.data.variants[0].measurements).toBeUndefined();
  expect(edited.body.data.variants[0].images).toEqual(['uploads/products/old.jpg']);
});

test.each([
  {}, { ...measurements, length: 0 }, { ...measurements, height: -1 },
  { ...measurements, width: undefined }, { ...measurements, unitValue: '' },
  { ...measurements, unit: 'Pieces', unitValue: 1.5 },
  { ...measurements, weightUnit: 'bad' }, { ...measurements, weight: Infinity },
])('seller create/update validation rejects incomplete or invalid measurements: %j', bad => {
  const body = { productName: 'Bad', shelfLifeDays: 30, variants: [{ label: 'A', measurements: bad }] };
  expect(createMyProductBody.safeParse(body).success).toBe(false);
  expect(updateMyProductBody.safeParse(body).success).toBe(false);
});

test('editing an existing dimensions record preserves its values using canonical measurements', async () => {
  const product = await Product.create({ ownerType: 'seller', sellerId, productName: 'Historical seller variant', variants: [{ label: 'red', sku: 'OLD' }] });
  const saved = { ...measurements, packagingType: 'HDPE Bag', unit: 'Grams', unitValue: 5 };
  await Product.collection.updateOne({ _id: product._id }, { $set: { 'variants.0.dimensions': saved } });
  const loaded = await request(app).get('/api/seller/my-products/' + product._id).set(auth(token));
  expect(loaded.status).toBe(200);
  const payload = formRoundTrip(loaded.body.data.variants);
  expect(payload[0].measurements).toEqual(saved);
  const edited = await request(app).put('/api/seller/my-products/' + product._id).set(auth(token)).field('variants', JSON.stringify(payload));
  expect(edited.status).toBe(200);
  const reopened = await request(app).get('/api/seller/my-products/' + product._id).set(auth(token));
  expect(reopened.body.data.variants[0].measurements).toEqual(saved);
});
