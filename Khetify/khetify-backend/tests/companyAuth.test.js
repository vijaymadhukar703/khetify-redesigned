const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Company = require("../model/Company/Company");
const companyCtrl = require("../controller/Company/companyController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

describe("loginCompany tolerates a stale/legacy field on the document", () => {
  test("a company with a removed enum value (company_pattern) can still log in", async () => {
    // Recreate the bug: raw-insert (bypassing Mongoose validation) a company
    // whose imsSettings.lotNumberingMethod holds the removed 'company_pattern'.
    const passwordHash = await bcrypt.hash("secret123", 10);
    const { insertedId } = await Company.collection.insertOne({
      fullName: "Legacy Co",
      email: "legacy@x.com",
      password: passwordHash,
      status: "approved",
      imsSettings: { lotNumberingMethod: "company_pattern" }, // illegal under the new enum
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = mockRes();
    await companyCtrl.loginCompany({ body: { email: "legacy@x.com", password: "secret123" } }, res);

    // Login succeeds — the last-login save validates only the modified field,
    // so the stale value never trips full-document validation.
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
    // and the token was persisted by that save
    const saved = await Company.findById(insertedId).select("token");
    expect(saved.token).toBeTruthy();
  });
});

describe("registerCompany required-field validation", () => {
  test("rejects payloads missing/blank a required field", async () => {
    const base = { fullName: "Acme Agro", email: "acme@x.com", number: "9876543210", password: "secret123" };
    for (const body of [
      { ...base, fullName: "" },                 // blank name
      { ...base, fullName: "   " },              // whitespace name
      { fullName: "Acme", number: "9876543210", password: "secret123" }, // no email
      { fullName: "Acme", email: "acme@x.com", password: "secret123" }, // no phone
      { ...base, email: "not-an-email" },        // bad email
      { ...base, number: "12345" },              // bad phone (too short)
      { ...base, number: "98765432101" },        // bad phone (extra digit)
      { ...base, number: "98765abcde" },         // bad phone (invalid characters)
      { ...base, password: "123" },              // short password
    ]) {
      const res = mockRes();
      await companyCtrl.registerCompany({ body }, res);
      expect(res.statusCode).toBe(400);
    }
  });

  test("accepts a complete payload (email AND phone) and creates a pending company", async () => {
    const res = mockRes();
    await companyCtrl.registerCompany({ body: { fullName: "Acme Agro", email: "ok@x.com", number: "9876543210", password: "secret123" } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.token).toBeTruthy();
    const saved = await Company.findById(res.body.company._id);
    expect(saved.status).toBe("pending");
    expect(saved.email).toBe("ok@x.com");
    expect(saved.number).toBe("9876543210");
  });
});

describe("updateCompany onboarding-section validation (shared partial endpoint)", () => {
  let companyId;
  beforeEach(async () => {
    const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
    companyId = c._id;
  });
  const upd = (body) => ({ params: { id: String(companyId) }, body, user: { companyId } });

  test("a status-only submit (Step 5) is NOT blocked", async () => {
    const res = mockRes();
    await companyCtrl.updateCompany(upd({ status: "pending" }), res);
    expect(res.statusCode).toBe(200);
  });

  test("rejects a submitted companyInfo section with a blank/invalid required field", async () => {
    const blankName = mockRes();
    await companyCtrl.updateCompany(upd({ companyInfo: { companyName: "", businessType: "Pvt", established: "2018" } }), blankName);
    expect(blankName.statusCode).toBe(400);

    const badYear = mockRes();
    await companyCtrl.updateCompany(upd({ companyInfo: { companyName: "Acme", businessType: "Pvt", established: "abcd" } }), badYear);
    expect(badYear.statusCode).toBe(400);
  });

  test("rejects a submitted businessContact section with bad email/phone/blank", async () => {
    const full = { address: "1 Main Rd", region: "MP", authorizedPerson: "Raj", businessEmail: "raj@x.com", businessNumber: "9876543210" };

    const badEmail = mockRes();
    await companyCtrl.updateCompany(upd({ businessContact: { ...full, businessEmail: "nope" } }), badEmail);
    expect(badEmail.statusCode).toBe(400);

    const badPhone = mockRes();
    await companyCtrl.updateCompany(upd({ businessContact: { ...full, businessNumber: "123" } }), badPhone);
    expect(badPhone.statusCode).toBe(400);

    const ok = mockRes();
    await companyCtrl.updateCompany(upd({ businessContact: full }), ok);
    expect(ok.statusCode).toBe(200);
  });

  test("rejects blank verification ids when submitted", async () => {
    const res = mockRes();
    await companyCtrl.updateCompany(upd({ gstinNumber: "" }), res);
    expect(res.statusCode).toBe(400);
  });
});