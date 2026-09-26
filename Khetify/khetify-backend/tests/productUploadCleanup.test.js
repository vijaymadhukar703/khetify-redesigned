const fs = require('fs');
const os = require('os');
const path = require('path');
const mockDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'product-cleanup-'));
jest.mock('../middlewares/productUploadCleanup', () => ({
  ...jest.requireActual('../middlewares/productUploadCleanup'),
  PRODUCT_UPLOAD_DIRECTORY: mockDirectory,
}));
const cleanup = require('../middlewares/productUploadCleanup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Product = require('../model/Company/productModel');
const AdminProduct = require('../model/Admin/AdminProduct');
const SellerDocument = require('../model/PC/SellerDocument');
const Company = require('../model/Company/Company');
const app = express();
app.use(express.json());
app.use('/company', require('../routes/Company/productRoutes'));
app.use('/admin', require('../routes/Admin/adminProductRoutes'));
app.use('/seller', require('../routes/Seller/sellerMyProductRoutes'));
let observed, retained, product, tokens, owner;
beforeEach(async () => {
  observed = [];
  const capture = cleanup.capture;
  jest.spyOn(cleanup, 'capture').mockImplementation((req, root) => {
    const files = Object.values(req.files || {}).flat();
    for (const f of files) { expect(fs.existsSync(f.path)).toBe(true); observed.push(f.path); }
    capture(req, root);
  });
  retained = path.join(mockDirectory, 'retained.jpg');
  fs.writeFileSync(retained, 'existing');
  owner = new mongoose.Types.ObjectId();
  await Company.collection.insertOne({ _id: owner, companyInfo: { companyName: 'Test' } });
  await SellerDocument.create(['gst', 'pan', 'agriculture'].map(docType => ({ sellerId: owner, docType, fileKey: docType, fileUrl: 'https://example.test/' + docType })));
  product = await Product.create({ companyId: owner, productName: 'Unchanged', productImages: [retained] });
  const sign = body => 'Bearer ' + jwt.sign(body, process.env.JWT_SECRET);
  tokens = {
    company: sign({ id: String(owner), companyId: String(owner), role: 'company_admin' }),
    admin: sign({ id: String(owner), principalType: 'admin', role: 'super_admin' }),
    seller: sign({ id: String(owner), sellerId: String(owner), principalType: 'seller', role: 'seller_admin' }),
  };
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const file of fs.readdirSync(mockDirectory)) fs.unlinkSync(path.join(mockDirectory, file));
});
afterAll(() => fs.rmdirSync(mockDirectory));
const attach = req => req.attach('productImages', Buffer.from('image one'), 'one.png')
  .attach('productImages', Buffer.from('image two'), 'two.png')
  .attach('variantImages', Buffer.from('variant'), 'variant.png');

test.each(['company', 'admin', 'seller'])('%s create rejection removes real gallery and variant files', async area => {
  const before = await Product.findById(product._id).lean();
  let req = request(app).post('/' + area + (area === 'company' ? '/create' : '')).set('Authorization', tokens[area])
    .field('productName', '').field('kept_images', retained);
  if (area === 'company') req = req.field('companyId', String(new mongoose.Types.ObjectId()));
  const res = await attach(req);
  expect([400, 404]).toContain(res.status);
  expect(observed).toHaveLength(3);
  expect(observed.every(f => !fs.existsSync(f))).toBe(true);
  expect(fs.readFileSync(retained, 'utf8')).toBe('existing');
  expect(await Product.findById(product._id).lean()).toEqual(before);
  expect(await AdminProduct.countDocuments()).toBe(0);
});

test.each(['company', 'admin', 'seller'])('%s update rejection retains existing data and assets', async area => {
  const before = await Product.findById(product._id).lean();
  const id = area === 'company' ? 'invalid-id' : String(product._id);
  const res = await attach(request(app).put('/' + area + '/' + id).set('Authorization', tokens[area])
    .field('productName', '').field('kept_images', retained));
  expect(res.status).toBe(400);
  expect(observed).toHaveLength(3);
  expect(observed.every(f => !fs.existsSync(f))).toBe(true);
  expect(fs.existsSync(retained)).toBe(true);
  expect(await Product.findById(product._id).lean()).toEqual(before);
});

test.each(['company', 'admin', 'seller'])('%s successful create retains uploads', async area => {
  let req = request(app).post('/' + area + (area === 'company' ? '/create' : '')).set('Authorization', tokens[area])
    .field('productName', 'Successful').field('shelfLifeDays', '30');
  if (area === 'admin') req = req.field('companyName', 'Company').field('legalName', 'Legal');
  if (area === 'company') req = req.field('companyId', String(owner)).field('productUpload', 'saveDraft');
  const res = await req.attach('productImages', Buffer.from('new'), 'new.png');
  expect(res.status).toBe(201);
  expect(observed).toHaveLength(1);
  expect(fs.existsSync(observed[0])).toBe(true);
});

test('cleanup failure preserves the original validation error', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(fs.promises, 'unlink').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  const res = await request(app).post('/admin').set('Authorization', tokens.admin)
    .field('productName', '').attach('productImages', Buffer.from('new'), 'new.png');
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('Validation failed');
  expect(res.body.errors.length).toBeGreaterThan(0);
  expect(console.error).toHaveBeenCalled();
});

test('rollback is idempotent, ignores client paths and respects directory boundaries', async () => {
  const file = path.join(mockDirectory, 'new.jpg'); fs.writeFileSync(file, 'new');
  const outside = path.join(os.tmpdir(), 'outside-' + new mongoose.Types.ObjectId()); fs.writeFileSync(outside, 'existing');
  try {
    const req = { body: { kept_images: retained, productImages: [outside] }, files: {
      productImages: [{ path: file }, { path: file }, { path: outside }], variantImages: [{ path: path.join(mockDirectory, 'missing.jpg') }],
    } };
    // Invoke the real helper; the spy above verifies real Multer output only.
    jest.requireActual('../middlewares/productUploadCleanup').capture(req, mockDirectory);
    await cleanup.rollback(req); await cleanup.rollback(req);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(retained)).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
  } finally { fs.unlinkSync(outside); }
});

test('post-persistence response error never removes the committed upload', async () => {
  const file = path.join(mockDirectory, 'committed.jpg'); fs.writeFileSync(file, 'new');
  const req = { params: { id: String(product._id) }, body: { productName: 'Saved' }, files: { productImages: [{ path: file }] } };
  jest.requireActual('../middlewares/productUploadCleanup').capture(req, mockDirectory);
  const admin = await AdminProduct.create({ productName: 'Admin', companyName: 'Co', legalName: 'Legal' });
  req.params.id = String(admin._id);
  const res = { json: jest.fn().mockImplementationOnce(() => { throw new Error('response failed'); }), status: jest.fn().mockReturnThis() };
  await require('../controller/Admin/adminProductController').updateAdminProduct(req, res);
  expect((await AdminProduct.findById(admin._id)).productName).toBe('Saved');
  await cleanup.rollback(req);
  expect(fs.existsSync(file)).toBe(true);
});

test('company model validation rejection cleans files and leaves the product unchanged', async () => {
  const before = await Product.findById(product._id).lean();
  const res = await request(app).put('/company/' + product._id).set('Authorization', tokens.company)
    .field('variantType', 'invalid-type').field('kept_images', retained)
    .attach('productImages', Buffer.from('new'), 'new.png');
  expect(res.status).toBe(400);
  expect(observed).toHaveLength(1);
  expect(fs.existsSync(observed[0])).toBe(false);
  expect(await Product.findById(product._id).lean()).toEqual(before);
});

test('successful edit keeps retained assets and the newly referenced upload', async () => {
  const admin = await AdminProduct.create({ productName: 'Admin', companyName: 'Co', legalName: 'Legal', productImages: [retained] });
  const res = await request(app).put('/admin/' + admin._id).set('Authorization', tokens.admin)
    .field('kept_images', retained).attach('productImages', Buffer.from('new'), 'new.png');
  expect(res.status).toBe(200);
  expect(fs.existsSync(retained)).toBe(true);
  expect(fs.existsSync(observed[0])).toBe(true);
  expect((await AdminProduct.findById(admin._id)).productImages).toHaveLength(2);
});

test('uncertain database write outcome does not delete possibly referenced files', async () => {
  const file = path.join(mockDirectory, 'uncertain.jpg'); fs.writeFileSync(file, 'new');
  const req = { files: { productImages: [{ path: file }] } };
  jest.requireActual('../middlewares/productUploadCleanup').capture(req, mockDirectory);
  await cleanup.rollbackRejected(req, new Error('write acknowledgement lost'), true);
  expect(fs.existsSync(file)).toBe(true);
});
