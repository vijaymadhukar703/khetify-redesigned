const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Product = require('../model/Company/productModel');
const AdminProduct = require('../model/Admin/AdminProduct');
const Company = require('../model/Company/Company');
const SellerDocument = require('../model/PC/SellerDocument');
const compatibility = require('../services/variantEditCompatibility');
const app = express(); app.use(express.json());
app.use('/company', require('../routes/Company/productRoutes'));
app.use('/admin', require('../routes/Admin/adminProductRoutes'));
app.use('/seller', require('../routes/Seller/sellerMyProductRoutes'));
const complete = { packagingType: 'Bag', unit: 'Kilograms', unitValue: 5, length: 2, width: 3, height: 4, dimensionUnit: 'cm', weight: 6, weightUnit: 'kg' };
const shapes = [{}, { measurements: complete }, { measurements: { unit: 'Kilograms' } }, { measurements: null },
  { dimensions: complete }, { dimensions: { length: 2 } }, { measurements: { unitValue: 3 }, dimensions: complete }];
let owner, tokens;
beforeEach(async () => {
  owner = new mongoose.Types.ObjectId();
  await Company.collection.insertOne({ _id: owner, companyInfo: { companyName: 'Company' } });
  await SellerDocument.create(['gst', 'pan', 'agriculture'].map(docType => ({ sellerId: owner, docType, fileKey: docType, fileUrl: 'https://example.test/' + docType })));
  const sign = value => 'Bearer ' + jwt.sign(value, process.env.JWT_SECRET);
  tokens = {
    company: sign({ id: String(owner), companyId: String(owner), role: 'company_admin' }),
    admin: sign({ id: String(owner), principalType: 'admin', role: 'super_admin' }),
    seller: sign({ id: String(owner), sellerId: String(owner), principalType: 'seller', role: 'seller_admin' }),
  };
});
async function fixture(area, shape) {
  const Model = area === 'admin' ? AdminProduct : Product;
  const row = { _id: new mongoose.Types.ObjectId(), label: 'Red', stock: 9, sku: 'RED', hiddenLegacy: 'variant-keep', images: ['uploads/products/red.jpg'], ...shape };
  const value = { _id: new mongoose.Types.ObjectId(), companyId: owner, ownerType: area === 'seller' ? 'seller' : 'company',
    sellerId: area === 'seller' ? owner : null, productName: 'Before', companyName: 'Co', legalName: 'Legal', productUpload: 'saveDraft',
    mrp: 0, availableStock: 0, hiddenLegacy: 'keep', productImages: ['uploads/products/keep.jpg'], variants: [row] };
  await Model.collection.insertOne(value);
  return { Model, value, row };
}
function payload(row, shape, mode = 'preserve') {
  return { _id: String(row._id), label: row.label, sku: row.sku, images: row.images,
    ...JSON.parse(JSON.stringify(shape)), _measurementEdit: { baseline: JSON.parse(JSON.stringify(shape)), mode } };
}
for (const area of ['company', 'admin', 'seller']) {
  test(area + ' allows adding a valid new variant while preserving an existing historical variant', async () => {
    const shape = { measurements: { length: 2 } };
    const { Model, value, row } = await fixture(area, shape);
    const response = await request(app).put('/' + area + '/' + value._id).set('Authorization', tokens[area])
      .send({ variants: [payload(row, shape), { label: 'Blue', sku: 'BLUE', measurements: complete }], kept_images: value.productImages });
    expect(response.status).toBe(200);
    const saved = await Model.collection.findOne({ _id: value._id });
    expect(saved.variants).toHaveLength(2);
    expect(saved.variants[0]).toEqual(row);
    expect(saved.variants[1].measurements).toEqual(complete);
  });
  test(area + ' removal preserves retained raw data, ownership, images and inventory', async () => {
    const shape = { dimensions: { length: 2 }, measurements: null };
    const { Model, value, row } = await fixture(area, shape);
    const removed = { _id: new mongoose.Types.ObjectId(), label: 'Blue', sku: 'BLUE', stock: 7, image: 'uploads/products/blue.jpg' };
    await Model.collection.updateOne({ _id: value._id }, { $push: { variants: removed } });
    const Inventory = require('../model/Inventory/Inventory');
    const inventory = { _id: new mongoose.Types.ObjectId(), productId: value._id, variantSku: 'BLUE', availableStock: 7 };
    await Inventory.collection.insertOne(inventory);
    const response = await request(app).put('/' + area + '/' + value._id).set('Authorization', tokens[area])
      .send({ variants: [payload(row, shape)], kept_images: value.productImages });
    expect(response.status).toBe(200);
    const saved = await Model.collection.findOne({ _id: value._id });
    expect(saved.variants).toEqual([row]);
    for (const key of ['companyId', 'sellerId', 'ownerType', 'productImages', 'availableStock']) expect(saved[key]).toEqual(value[key]);
    expect(await Inventory.collection.findOne({ _id: inventory._id })).toEqual(inventory);
  });
  test(area + ' stale browser baseline detects changes to retained stock before request preparation', async () => {
    const shape = { measurements: { length: 2 } };
    const { Model, value, row } = await fixture(area, shape);
    const browserRow = area === 'company' ? Model.hydrate(value).variants[0].toObject({ flattenMaps: true }) : row;
    const retained = payload(row, shape);
    retained._measurementEdit.variantBaseline = JSON.parse(JSON.stringify(browserRow));
    await Model.collection.updateOne({ _id: value._id }, { $set: { 'variants.0.stock': 11 } });
    const response = await request(app).put('/' + area + '/' + value._id).set('Authorization', tokens[area])
      .send({ variants: [retained, { label: 'Blue', measurements: complete }] });
    expect(response.status).toBe(409);
    const saved = await Model.collection.findOne({ _id: value._id });
    expect(saved.variants).toHaveLength(1);
    expect(saved.variants[0].stock).toBe(11);
  });
  test(area + ' invalid new input and stale retained baseline reject without persistence', async () => {
    const shape = { measurements: { length: 2 } };
    const { Model, value, row } = await fixture(area, shape);
    const send = variants => request(app).put('/' + area + '/' + value._id).set('Authorization', tokens[area])
      .send({ variants, kept_images: value.productImages });
    expect((await send([payload(row, shape), { label: 'Blue', measurements: { length: 3 } }])).status).toBe(400);
    expect((await send([payload(row, shape), { label: 'Blue', _id: String(new mongoose.Types.ObjectId()), measurements: complete }])).status).toBe(409);
    expect((await send([payload(row, shape), payload(row, shape)])).status).toBe(409);
    expect((await send([payload(row, { measurements: { length: 1 } }), { label: 'Blue', measurements: complete }])).status).toBe(409);
    expect((await Model.collection.findOne({ _id: value._id })).variants).toEqual(value.variants);
  });
  test(area + ' reorder and edit retained rows by ID while adding a new row', async () => {
    const shape = { measurements: { length: 2 } };
    const { Model, value, row } = await fixture(area, shape);
    const second = { ...row, _id: new mongoose.Types.ObjectId(), label: 'Green', sku: 'GREEN', stock: 4, dimensions: { width: 8 } };
    await Model.collection.updateOne({ _id: value._id }, { $push: { variants: second } });
    const response = await request(app).put('/' + area + '/' + value._id).set('Authorization', tokens[area]).send({
      kept_images: value.productImages, variants: [payload(second, { ...shape, dimensions: second.dimensions }),
        { label: 'Blue', measurements: complete }, { ...payload(row, shape), label: 'Renamed', images: ['uploads/products/replacement.jpg'] }]
    });
    expect(response.status).toBe(200);
    const saved = await Model.collection.findOne({ _id: value._id });
    expect(saved.variants[0]).toEqual(second);
    expect(saved.variants[1]._id).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(saved.variants[1]._id).not.toEqual(row._id);
    expect(saved.variants[1].stock).toBe(0);
    expect(saved.variants[1]).not.toHaveProperty('dimensions');
    expect(saved.variants[2]).toMatchObject({ ...row, label: 'Renamed', images: ['uploads/products/replacement.jpg'] });
    for (const key of ['companyId', 'sellerId', 'ownerType', 'productImages']) expect(saved[key]).toEqual(value[key]);
  });
  test.each(shapes)(area + ' unrelated draft edit preserves raw historical data: %j', async shape => {
    const { Model, value, row } = await fixture(area, shape);
    const loaded = await request(app).get('/' + area + '/' + value._id).set('Authorization', tokens[area]);
    expect(loaded.status).toBe(200);
    const retained = payload(row, shape);
    retained._measurementEdit.variantBaseline = loaded.body.data.variants[0];
    const res = await request(app).put('/' + area + '/' + value._id).set('Authorization', tokens[area])
      .send({ description: 'Changed', mrp: 0, variants: [retained], kept_images: value.productImages });
    expect(res.status).toBe(200);
    const saved = await Model.collection.findOne({ _id: value._id });
    expect(saved.variants).toEqual(value.variants);
    for (const key of ['companyId', 'sellerId', 'ownerType', 'productImages', 'hiddenLegacy', 'availableStock', 'mrp', 'productUpload']) expect(saved[key]).toEqual(value[key]);
    expect(saved.description).toBe('Changed');
  });
  test(area + ' strict replacement, explicit clear and identity checks', async () => {
    const shape = { dimensions: { length: 2 } };
    const { Model, value, row } = await fixture(area, shape);
    const send = variants => request(app).put('/' + area + '/' + value._id).set('Authorization', tokens[area]).send({ variants, kept_images: value.productImages });
    const bad = { ...payload(row, shape, 'replace'), measurements: { length: 8 } };
    expect((await send([bad])).status).toBe(400);
    expect((await Model.collection.findOne({ _id: value._id })).variants).toEqual(value.variants);
    expect((await send([{ ...payload(row, shape), _id: String(new mongoose.Types.ObjectId()) }])).status).toBe(409);
    expect((await send([payload(row, shape), payload(row, shape)])).status).toBe(409);
    expect((await send([{ ...payload(row, shape, 'replace'), measurements: complete }])).status).toBe(200);
    const currentShape = { ...shape, measurements: complete };
    const clearing = payload(row, currentShape, 'clear'); delete clearing.measurements;
    expect((await send([clearing])).status).toBe(200);
    const saved = await Model.collection.findOne({ _id: value._id });
    expect(saved.variants[0]).not.toHaveProperty('measurements');
    expect(saved.variants[0]).not.toHaveProperty('dimensions');
    expect(saved.variants[0]._id).toEqual(row._id);
    expect(saved.variants[0].stock).toBe(9);
  });
}
test('concurrent raw variant change fails the atomic update', async () => {
  const shape = { measurements: { length: 2 } };
  const { Model, value, row } = await fixture('company', shape);
  const req = { user: { companyId: owner }, params: { productId: String(value._id) }, body: { variants: [payload(row, shape)] } };
  const next = jest.fn(); const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await compatibility.prepare('company')(req, res, next);
  expect(next).toHaveBeenCalled();
  await Model.collection.updateOne({ _id: value._id }, { $set: { 'variants.0.stock': 12 } });
  await expect(compatibility.update(req, req.body)).rejects.toMatchObject({ status: 409 });
  expect((await Model.collection.findOne({ _id: value._id })).variants[0].stock).toBe(12);
});

for (const area of ['company', 'admin', 'seller']) {
  test(area + ' concurrent addition does not invalidate retained baseline or get overwritten', async () => {
    const shape = { dimensions: { length: 2 } };
    const { Model, value, row } = await fixture(area, shape);
    const req = { user: { companyId: owner, sellerId: owner }, params: { productId: String(value._id) },
      body: { variants: [payload(row, shape), { label: 'Blue', measurements: complete }] } };
    const next = jest.fn(); const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await compatibility.prepare(area)(req, res, next);
    expect(next).toHaveBeenCalled();
    const concurrent = { _id: new mongoose.Types.ObjectId(), label: 'Concurrent', stock: 8, dimensions: { height: 9 } };
    await Model.collection.updateOne({ _id: value._id }, { $push: { variants: concurrent } });
    await compatibility.update(req, req.body);
    const saved = await Model.collection.findOne({ _id: value._id });
    expect(saved.variants).toHaveLength(3);
    expect(saved.variants[0]).toEqual(row);
    expect(saved.variants[2]).toEqual(concurrent);
  });
}

test('company can intentionally change the single variant image while adding a variant', async () => {
  const shape = { measurements: { length: 2 } };
  const { Model, value, row } = await fixture('company', shape);
  const response = await request(app).put('/company/' + value._id).set('Authorization', tokens.company)
    .send({ variants: [{ ...payload(row, shape), image: 'uploads/products/new-primary.jpg' }, { label: 'Blue', measurements: complete }] });
  expect(response.status).toBe(200);
  expect((await Model.collection.findOne({ _id: value._id })).variants[0]).toEqual({ ...row, image: 'uploads/products/new-primary.jpg' });
});
