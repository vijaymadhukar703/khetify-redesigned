const mongoose = require("mongoose");
const Seller = require("../model/Seller/Seller");
const SellerDocument = require("../model/PC/SellerDocument");
const auth = require("../controller/Seller/sellerAuthController");

jest.mock("../services/fileService", () => ({
  uploadBuffer: jest.fn(async (buf, key) => ({ url: `https://cdn.test/${key}` })),
  signedUrl: jest.fn(async (key) => (key ? `https://signed.test/${key}` : null)),
  publicFileUrl: jest.fn(async (key) => (key ? `https://public.test/${key}` : null)),
}));

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const asSeller = (sellerId, body = {}, files = {}) => ({
  user: { sellerId, principalType: "seller", role: "seller_admin", id: sellerId },
  body, files, params: {}, query: {},
});
// What multer's memoryStorage hands over.
const upload = (name, type = "image/png", size = 1024) => ({
  originalname: name, mimetype: type, size, buffer: Buffer.from("x"),
});

const LICENCES = ["tan", "gumasta", "udyam", "agriculture", "horticulture"];

let sellerId;
beforeEach(async () => {
  const s = await Seller.create({
    email: `s${Date.now()}@t.com`, passwordHash: "x", phone: "9999999999",
    sellerInfo: { businessName: "Test Seller" },
  });
  sellerId = s._id;
});

const patch = async (body, files) => {
  const res = mockRes();
  await auth.updateSellerProfile(asSeller(sellerId, body, files), res);
  return res;
};
const get = async () => {
  const res = mockRes();
  await auth.getSellerProfile(asSeller(sellerId), res);
  return res.body.data;
};

describe("1. all five licences save, with numbers and certificates", () => {
  test("numbers + PNG certificates round-trip", async () => {
    const res = await patch(
      {
        tanNumber: "MUMA12345B", gumastaNumber: "GUM123", udyamNumber: "UDYAM-MP-23-0001234",
        agricultureNumber: "AGR123", horticultureNumber: "HOR123",
      },
      Object.fromEntries(LICENCES.map((k) => [`${k}Certificate`, [upload(`${k}.png`)]]))
    );
    expect(res.statusCode).toBe(200);

    const data = await get();
    for (const k of LICENCES) {
      expect(data.licences[k].number).toBe(
        { tan: "MUMA12345B", gumasta: "GUM123", udyam: "UDYAM-MP-23-0001234", agriculture: "AGR123", horticulture: "HOR123" }[k]
      );
      expect(data.licences[k].url).toMatch(/^https:\/\/signed\.test\//);
      expect(data.licences[k].fileName).toBe(`${k}.png`);
    }
    // One document row per licence — no duplicates.
    expect(await SellerDocument.countDocuments({ sellerId })).toBe(5);
  });

  test("the number is snapshotted onto the document row too", async () => {
    await patch({ tanNumber: "MUMA12345B" }, { tanCertificate: [upload("tan.png")] });
    const doc = await SellerDocument.findOne({ sellerId, docType: "tan" }).lean();
    expect(doc.documentNumber).toBe("MUMA12345B");
  });
});

describe("2. PDF is accepted", () => {
  test("a PDF certificate stores like any other file", async () => {
    const res = await patch(
      { tanNumber: "MUMA12345B" },
      { tanCertificate: [upload("tan.pdf", "application/pdf")] }
    );
    expect(res.statusCode).toBe(200);

    const data = await get();
    expect(data.licences.tan.fileName).toBe("tan.pdf");
    expect(data.licences.tan.url).toBeTruthy();
  });

  test("a file over 5MB is refused with a named message", async () => {
    const res = await patch(
      { tanNumber: "MUMA12345B" },
      { tanCertificate: [upload("big.pdf", "application/pdf", 6 * 1024 * 1024)] }
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/5MB or smaller/i);
  });
});

describe("3. re-uploading REPLACES, it does not duplicate", () => {
  test("a second upload of the same licence keeps one row and the newest file", async () => {
    await patch({ tanNumber: "MUMA12345B" }, { tanCertificate: [upload("first.png")] });
    await patch({ tanNumber: "MUMA12345C" }, { tanCertificate: [upload("second.png")] });

    const rows = await SellerDocument.find({ sellerId, docType: "tan" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].fileName).toBe("second.png");
    expect(rows[0].documentNumber).toBe("MUMA12345C");
  });
});

describe("4. a licence left blank reads as empty, not missing", () => {
  test("every key is present with nulls so the UI can show 'Not provided'", async () => {
    const data = await get();
    for (const k of LICENCES) {
      expect(data.licences[k]).toEqual({ number: "", url: null, fileName: null, status: null, documentId: null });
    }
  });

  test("a NUMBER with no certificate still saves — the row cannot exist without a file", async () => {
    // This is why the numbers live on the seller, not on SellerDocument.
    await patch({ agricultureNumber: "AGR-ONLY" }, {});
    const data = await get();
    expect(data.licences.agriculture.number).toBe("AGR-ONLY");
    expect(data.licences.agriculture.url).toBeNull();
    expect(await SellerDocument.countDocuments({ sellerId })).toBe(0);
  });

  test("saving one licence does not clear the others", async () => {
    await patch({ tanNumber: "MUMA12345B" }, {});
    await patch({ gumastaNumber: "GUM1" }, {});
    const data = await get();
    expect(data.licences.tan.number).toBe("MUMA12345B");
    expect(data.licences.gumasta.number).toBe("GUM1");
  });
});

describe("5. GSTIN / PAN and the existing document flow are untouched", () => {
  test("gst + pan still save and still surface on compliance", async () => {
    const res = await patch(
      { gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F" },
      { gstCertificate: [upload("gst.pdf", "application/pdf")], panFile: [upload("pan.png")] }
    );
    expect(res.statusCode).toBe(200);

    const data = await get();
    expect(data.compliance.gstin).toBe("27AAPFU0939F1ZV");
    expect(data.compliance.pan).toBe("AAPFU0939F");
    expect(data.compliance.gstCertificateUrl).toBeTruthy();
    expect(data.compliance.panFileUrl).toBeTruthy();
  });

  test("gst/pan rows carry NO documentNumber — only the licence rows do", async () => {
    await patch({ gstin: "27AAPFU0939F1ZV" }, { gstCertificate: [upload("gst.pdf", "application/pdf")] });
    const doc = await SellerDocument.findOne({ sellerId, docType: "gst" }).lean();
    expect(doc.documentNumber).toBeUndefined();
  });

  test("'other' documents still APPEND rather than replace", async () => {
    await patch({}, { otherDocs: [upload("a.png"), upload("b.png")] });
    await patch({}, { otherDocs: [upload("c.png")] });
    expect(await SellerDocument.countDocuments({ sellerId, docType: "other" })).toBe(3);
  });

  test("licence rows and gst/pan/other coexist without interfering", async () => {
    await patch(
      { gstin: "27AAPFU0939F1ZV", tanNumber: "MUMA12345B" },
      { gstCertificate: [upload("gst.pdf", "application/pdf")], tanCertificate: [upload("tan.png")], otherDocs: [upload("misc.png")] }
    );
    const data = await get();
    expect(data.compliance.gstCertificateUrl).toBeTruthy();
    expect(data.licences.tan.url).toBeTruthy();
    expect(data.documents.length).toBe(3);
  });
});

describe("6. licence number FORMAT — strict on TAN and Udyam only", () => {
  test("a valid TAN and a valid Udyam are accepted", async () => {
    const res = await patch({ tanNumber: "MUMA12345B", udyamNumber: "UDYAM-MP-23-0001234" }, {});
    expect(res.statusCode).toBe(200);
    const data = await get();
    expect(data.licences.tan.number).toBe("MUMA12345B");
    expect(data.licences.udyam.number).toBe("UDYAM-MP-23-0001234");
  });

  test.each([["ABC123"], ["MUMA1234B"], ["MUM12345B"], ["MUMA123456"], ["MUMA12345BB"]])(
    "a malformed TAN (%s) is refused with the format hint",
    async (bad) => {
      const res = await patch({ tanNumber: bad }, {});
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/4 letters, 5 digits, 1 letter/i);
    }
  );

  test.each([["UDYAM123"], ["UDYAM-M-23-0001234"], ["UDYAM-MP-2-0001234"], ["UDYAM-MP-23-000123"], ["MP-23-0001234"]])(
    "a malformed Udyam (%s) is refused with the format hint",
    async (bad) => {
      const res = await patch({ udyamNumber: bad }, {});
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/UDYAM-MP-23-0001234/);
    }
  );

  test("lowercase input is uppercased rather than rejected", async () => {
    const res = await patch({ tanNumber: "muma12345b", udyamNumber: "udyam-mp-23-0001234" }, {});
    expect(res.statusCode).toBe(200);
    const data = await get();
    expect(data.licences.tan.number).toBe("MUMA12345B");
    expect(data.licences.udyam.number).toBe("UDYAM-MP-23-0001234");
  });

  test("the state-issued three accept ANY shape — no national format exists", async () => {
    // Real examples differ wildly by state; a regex here would lock those
    // sellers out of recording their licence at all.
    const res = await patch({
      gumastaNumber: "mh/shop/2019/44821",
      agricultureNumber: "AGRI licence 12-B",
      horticultureNumber: "hp-hort-7",
    }, {});
    expect(res.statusCode).toBe(200);

    const data = await get();
    expect(data.licences.gumasta.number).toBe("MH/SHOP/2019/44821");
    expect(data.licences.agriculture.number).toBe("AGRI LICENCE 12-B");
    expect(data.licences.horticulture.number).toBe("HP-HORT-7");
  });

  test("surrounding whitespace is trimmed on the free-form three", async () => {
    const res = await patch({ gumastaNumber: "   mh/shop/1   " }, {});
    expect(res.statusCode).toBe(200);
    expect((await get()).licences.gumasta.number).toBe("MH/SHOP/1");
  });

  test("over 30 characters is refused on a free-form licence", async () => {
    const res = await patch({ agricultureNumber: "A".repeat(31) }, {});
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/too long/i);
  });

  test("BLANK is always allowed — every licence is optional", async () => {
    const res = await patch(
      { tanNumber: "", udyamNumber: "", gumastaNumber: "", agricultureNumber: "", horticultureNumber: "" },
      {}
    );
    expect(res.statusCode).toBe(200);
    const data = await get();
    for (const k of LICENCES) expect(data.licences[k].number).toBe("");
  });

  test("clearing a previously saved TAN is allowed", async () => {
    await patch({ tanNumber: "MUMA12345B" }, {});
    const res = await patch({ tanNumber: "" }, {});
    expect(res.statusCode).toBe(200);
    expect((await get()).licences.tan.number).toBe("");
  });

  test("a bad licence does NOT get past the client — the server refuses it too", async () => {
    const res = await patch({ tanNumber: "NOTATAN" }, {});
    expect(res.statusCode).toBe(400);
    // ...and nothing was written.
    expect((await get()).licences.tan.number).toBe("");
  });
});

describe("7. GSTIN / PAN validation is untouched", () => {
  test("a valid GSTIN and PAN still save", async () => {
    const res = await patch({ gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F" }, {});
    expect(res.statusCode).toBe(200);
  });

  test("an invalid GSTIN still fails with its own original message", async () => {
    const res = await patch({ gstin: "NOPE" }, {});
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/valid 15-character GSTIN/i);
  });

  test("an invalid PAN still fails with its own original message", async () => {
    const res = await patch({ pan: "NOPE" }, {});
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/valid 10-character PAN/i);
  });
});

describe("8. the registration Udyam prefills the profile", () => {
  const REG = "UDYAM-MP-23-0001234";
  const NEW = "UDYAM-UP-24-0009999";

  /** A seller whose Udyam was captured at REGISTRATION only. */
  const withRegistrationUdyam = async () => {
    await Seller.findByIdAndUpdate(sellerId, { $set: { "verification.udyam": REG } });
  };

  test("both the compliance field and the licence row show it, with no re-typing", async () => {
    await withRegistrationUdyam();
    const data = await get();
    // The licence row used to open EMPTY here — the seller was asked for a
    // number they had already given at sign-up.
    expect(data.licences.udyam.number).toBe(REG);
    expect(data.compliance.udyam).toBe(REG);
  });

  test("it is editable — saving a new number updates BOTH", async () => {
    await withRegistrationUdyam();
    const res = await patch({ udyamNumber: NEW }, {});
    expect(res.statusCode).toBe(200);

    const data = await get();
    expect(data.licences.udyam.number).toBe(NEW);
    expect(data.compliance.udyam).toBe(NEW);

    // ...and the registration field itself really moved, so a reload agrees.
    const seller = await Seller.findById(sellerId).lean();
    expect(seller.verification.udyam).toBe(NEW);
    expect(seller.verification.licences.udyam).toBe(NEW);
  });

  test("an edited value wins over the registration one", async () => {
    await withRegistrationUdyam();
    await patch({ udyamNumber: NEW }, {});
    // Simulate the registration field lagging behind; the licence value leads.
    await Seller.findByIdAndUpdate(sellerId, { $set: { "verification.udyam": REG } });
    expect((await get()).licences.udyam.number).toBe(NEW);
  });

  test("the Udyam certificate now surfaces on the compliance card too", async () => {
    await patch({ udyamNumber: REG }, { udyamCertificate: [upload("udyam.pdf", "application/pdf")] });
    const data = await get();
    expect(data.compliance.udyamCertificateUrl).toBeTruthy();
    expect(data.licences.udyam.url).toBe(data.compliance.udyamCertificateUrl);
  });

  test("a seller with NO udyam anywhere still reads empty, not undefined", async () => {
    const data = await get();
    expect(data.licences.udyam.number).toBe("");
    expect(data.compliance.udyam).toBe("");
  });

  test("the other four licences are NOT affected by the udyam fallback", async () => {
    await withRegistrationUdyam();
    const data = await get();
    for (const k of ["tan", "gumasta", "agriculture", "horticulture"]) {
      expect(data.licences[k].number).toBe("");
    }
  });

  test("GSTIN and PAN are untouched by any of this", async () => {
    await withRegistrationUdyam();
    await patch({ gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F" }, {});
    const data = await get();
    expect(data.compliance.gstin).toBe("27AAPFU0939F1ZV");
    expect(data.compliance.pan).toBe("AAPFU0939F");
    expect(data.compliance.udyam).toBe(REG);
  });
});

describe("9. every licence certificate reaches the documents list", () => {
  test("GUMASTA lands with docType 'gumasta' and its full label", async () => {
    // The one that was reported missing. It is not special in any way — the
    // point of this test is that it can never be the odd one out again.
    await patch({ gumastaNumber: "MH/SHOP/1" }, { gumastaCertificate: [upload("gumasta.png")] });

    const row = await SellerDocument.findOne({ sellerId, docType: "gumasta" }).lean();
    expect(row).toBeTruthy();
    expect(row.label).toBe("Gumasta / Shop Act Certificate");

    const data = await get();
    const listed = data.documents.find((d) => d.docType === "gumasta");
    expect(listed).toBeTruthy();
    expect(listed.label).toBe("Gumasta / Shop Act Certificate");
    // View / Download need a url, and the Pending pill needs a status.
    expect(listed.url).toBeTruthy();
    expect(listed.status).toBe("pending");
  });

  test("ALL FIVE appear together — none silently dropped", async () => {
    await patch(
      { tanNumber: "MUMA12345B", udyamNumber: "UDYAM-MP-23-0001234" },
      Object.fromEntries(LICENCES.map((k) => [`${k}Certificate`, [upload(`${k}.png`)]]))
    );

    const data = await get();
    const byType = Object.fromEntries(data.documents.map((d) => [d.docType, d.label]));
    expect(byType).toMatchObject({
      tan: "TAN Certificate",
      gumasta: "Gumasta / Shop Act Certificate",
      udyam: "Udyam Certificate",
      agriculture: "Agriculture Licence",
      horticulture: "Horticulture Licence",
    });
    expect(data.documents).toHaveLength(5);
  });

  test("replacing the gumasta file updates the row instead of adding one", async () => {
    await patch({}, { gumastaCertificate: [upload("first.png")] });
    await patch({}, { gumastaCertificate: [upload("second.png")] });

    const rows = await SellerDocument.find({ sellerId, docType: "gumasta" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].fileName).toBe("second.png");

    const data = await get();
    expect(data.documents.filter((d) => d.docType === "gumasta")).toHaveLength(1);
  });

  test("a row saved with NO label still reads as a licence, not a filename", async () => {
    // How the Certifications screen stores one (label defaults to the filename),
    // and how any pre-existing row may look.
    await SellerDocument.create({
      sellerId, docType: "gumasta", fileKey: "sellers/x/legacy.png", fileName: "scan_final_v2.png", label: "",
    });
    const data = await get();
    expect(data.documents.find((d) => d.docType === "gumasta").label).toBe("Gumasta / Shop Act Certificate");
  });
});
