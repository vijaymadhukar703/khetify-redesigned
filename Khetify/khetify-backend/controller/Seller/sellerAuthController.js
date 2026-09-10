const Seller = require("../../model/Seller/Seller");
const Company = require("../../model/Company/Company");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { capabilitiesForRole, deniedForRole } = require("../../config/permissions");
const User = require("../../model/User/User");
const { isBlank, isEmail, isPhone10, isPincode, isGstin, isPan, isValidYear } = require("../../utils/fieldValidators");
const { notify } = require("../../services/notificationService");
const SellerCompanyLink = require("../../model/Seller/SellerCompanyLink");
const SellerDocument = require("../../model/PC/SellerDocument");
const Warehouse = require("../../model/Warehouse/Warehouse");
const fileService = require("../../services/fileService");
const path = require("path");
const { buildLocationAccess, applyLocationAccess, publicLocationAccess } = require("../../services/locationAccessService");
const { reverseGeocode } = require("../../services/reverseGeocodeService");

/** Seller principal token. Mirrors the company-owner token but carries the
 * seller scope + principalType so authMiddleware/RBAC route it correctly. */
function signSellerToken(seller) {
  return jwt.sign(
    { id: seller._id, sellerId: seller._id, principalType: "seller", role: "seller_admin" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}

/** Token for a SELLER TEAM MEMBER (a User owned by the seller). Same shape as
 * the owner token but `id` is the member, `sellerId` is the seller ACCOUNT
 * (ownerId) so seller-scoped queries resolve, and `role` is the member's role. */
function signSellerMemberToken(member) {
  return jwt.sign(
    { id: member._id, sellerId: member.ownerId, principalType: "seller", role: member.role, warehouseIds: (member.warehouseIds || []).map(String) },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}

/** Strip the password hash before returning a seller to the client. */
function publicSeller(seller) {
  return {
    _id: seller._id,
    email: seller.email,
    phone: seller.phone,
    status: seller.status,
    sellerInfo: seller.sellerInfo,
    contact: seller.contact,
    verification: seller.verification,
    supplyingCompanyId: seller.supplyingCompanyId,
    linkStatus: seller.linkStatus,
    linkRejectionReason: seller.linkRejectionReason,
    linkApprovalAcknowledged: seller.linkApprovalAcknowledged,
    // Live-location consent, so the portal knows whether it still has to ask.
    // Present on BOTH /me and the login response, which is what lets the
    // prompt decide without an extra round trip.
    locationAccess: publicLocationAccess(seller.locationAccess),
  };
}

/** Display name for a company doc (companies store the name a few ways). */
function companyName(company) {
  return company?.companyInfo?.companyName || company?.fullName || "Company";
}

/* ================= REGISTER ================= */
exports.registerSeller = async (req, res) => {
  try {
    const { businessName, email, phone, password } = req.body;

    // Every field is required: business name, a VALID email, a 10-digit phone,
    // and a password of at least 6 characters. (The UI blocks blank submits too.)
    if (isBlank(businessName)) {
      return res.status(400).json({ message: "Business name is required" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }
    if (!isPhone10(phone)) {
      return res.status(400).json({ message: "Phone number must be 10 digits" });
    }
    if (isBlank(password) || String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normEmail = email ? String(email).toLowerCase().trim() : null;
    const normPhone = phone ? String(phone).trim() : null;

    // Reject duplicate email — check separately for specific error message
    const existingEmail = normEmail ? await Seller.findOne({ email: normEmail }) : null;
    if (existingEmail) {
      return res.status(400).json({ message: "This email is already registered." });
    }

    // Reject duplicate phone
    const existingPhone = normPhone ? await Seller.findOne({ phone: normPhone }) : null;
    if (existingPhone) {
      return res.status(400).json({ message: "This phone number is already registered." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const seller = await Seller.create({
      email: normEmail,
      phone: normPhone,
      passwordHash,
      status: "pending",
      sellerInfo: { businessName },
    });

    const token = signSellerToken(seller);

    res.status(201).json({
      message: "Seller registered successfully",
      token,
      seller: publicSeller(seller),
    });
  } catch (error) {
    console.error("Seller Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* ================= LOGIN ================= */
exports.loginSeller = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    const query = [];
    if (email) query.push({ email: String(email).toLowerCase().trim() });
    if (phone) query.push({ phone: String(phone).trim() });

    if (!password || query.length === 0) {
      return res.status(400).json({ message: "Email/Phone and password required" });
    }

    const seller = await Seller.findOne({ $or: query });
    if (seller && seller.passwordHash && (await bcrypt.compare(String(password).trim(), seller.passwordHash))) {
      // Seller ACCOUNT owner login.
      return res.json({ message: "Login successful", token: signSellerToken(seller), status: seller.status, seller: publicSeller(seller) });
    }

    // Fall back to a SELLER TEAM MEMBER (a User owned by a seller account).
    const member = await User.findOne({ ownerType: "seller", $or: query });
    if (member && member.passwordHash && (await bcrypt.compare(String(password).trim(), member.passwordHash))) {
      if (member.status !== "active") {
        return res.status(403).json({ message: `Account is ${member.status} — ask your seller admin` });
      }
      const account = await Seller.findById(member.ownerId).select("-passwordHash");
      if (!account) return res.status(400).json({ message: "Invalid credentials" });
      member.lastLoginAt = new Date();
      await member.save();
      return res.json({
        message: "Login successful",
        token: signSellerMemberToken(member),
        status: account.status,
        seller: publicSeller(account),
        member: { id: member._id, name: member.name, role: member.role },
      });
    }

    return res.status(400).json({ message: "Invalid credentials" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ================= GET ME ================= */
exports.getSellerMe = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.sellerId).select("-passwordHash");
    if (!seller) {
      return res.status(404).json({ message: "Seller not found" });
    }
    const role = req.user.role || "seller_admin";
    const businessName = seller.sellerInfo?.businessName || "Seller";

    // Owner tokens carry id === sellerId; a team member's id differs. For a
    // member we surface the MEMBER's own identity as the display profile (name,
    // email, phone) while keeping the seller account name as `businessName`/
    // `accountName` for context. The owner behaves exactly as before.
    const isMember = String(req.user.id) !== String(req.user.sellerId);
    let displayName = businessName;
    let memberFields = {};
    if (isMember) {
      const member = await User.findOne({ _id: req.user.id, ownerType: "seller", ownerId: req.user.sellerId })
        .select("name email phone role");
      if (member) {
        displayName = member.name || businessName;
        memberFields = {
          memberId: member._id,
          email: member.email,
          phone: member.phone,
        };
      }
    }

    res.json({
      success: true,
      data: {
        ...publicSeller(seller),
        ...memberFields, // member email/phone override the account's for display
        principalType: "seller",
        sellerId: seller._id,
        // `name` is what the header/greeting shows: the member's name for a
        // member, the business name for the owner. The seller business name is
        // always available separately for a secondary label.
        name: displayName,
        businessName,
        accountName: businessName,
        isMember,
        role,
        capabilities: capabilitiesForRole(role),
        deniedCapabilities: deniedForRole(role),
        warehouseIds: req.user.warehouseIds || [],
        // ADDITIVE, read-only: the NAMES of the warehouse(s) this member is
        // assigned to. The header shows the manager's warehouse under their
        // name, and `warehouseIds` alone carries only ids. Scoped to this
        // seller's own warehouses, so a stale id in an old token resolves to
        // nothing rather than leaking another seller's warehouse name.
        // seller_admin has no assignment and gets an empty list.
        warehouses: await sellerWarehouseNames(seller._id, req.user.warehouseIds),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * The warehouse(s) a member is assigned to, as { _id, name, code }.
 *
 * Read-only and additive — it adds no rule and changes no scope. The assignment
 * itself still comes from the token (`req.user.warehouseIds`), exactly as
 * before; this only resolves those ids to names so the header can show which
 * warehouse the logged-in manager is standing in.
 */
async function sellerWarehouseNames(sellerId, warehouseIds) {
  const ids = (warehouseIds || []).filter(Boolean);
  if (!ids.length) return [];
  const rows = await Warehouse.find({ _id: { $in: ids }, sellerId })
    .select("name code")
    .lean();
  return rows.map((w) => ({ _id: String(w._id), name: w.name, code: w.code || null }));
}

/* ── OTHER REGISTRATION LICENCES ──────────────────────────────────────────
   The five extra registrations a seller may hold. Described ONCE here so the
   read path, the write path and the multipart field names cannot drift apart
   — adding a sixth is one row in this list plus one line in the route's
   multer fields().

     key      where the NUMBER lives, under seller.verification.licences
     field    the text field the Profile form posts
     file     the multipart file field (must match routes/Seller/sellerRoutes.js)
     docType  the SellerDocument row's type — one row per licence, replaced
              on re-upload (upsertSellerDoc replaces everything but "other") */
/* WHICH LICENCE NUMBERS CAN BE FORMAT-CHECKED, AND WHICH MUST NOT BE.

   TAN and Udyam are issued centrally and have ONE published format, so a
   value that does not match is a typo and is worth refusing.

   Gumasta / Shop Act, Agriculture and Horticulture licences are issued by
   each STATE in its own scheme — there is no national format to check
   against. A regex here would reject real licence numbers and leave those
   sellers unable to record their licence at all, which is far worse than
   accepting an odd-looking one. `re: null` says that is deliberate, not an
   oversight.

   What those three DO get is a sanity check, not a format check: trim +
   uppercase, a 4-30 character length, and a character set of letters, digits,
   hyphen and slash. That accepts every real shape a state uses
   ("MP/AGRI/2024-1234", "AB/1234-XY") while still refusing a stray "SDF" or an
   email address pasted into the box.

   EVERY field is optional: the check runs only on a non-empty value. */
const LICENCE_MAX_LEN = 30;
const LICENCE_MIN_LEN = 4;
// Hyphen last so it is a literal, not a range.
const LICENCE_CHARS_RE = /^[A-Z0-9/-]+$/;
const LICENCE_CHARS_HINT = `Use only letters, digits, - and / (${LICENCE_MIN_LEN}-${LICENCE_MAX_LEN} characters)`;

/* Licences whose check is skipped when the posted value is IDENTICAL to the one
   already stored — a value recorded before these rules existed must not make the
   rest of the profile unsaveable (see the write loop). Udyam is deliberately not
   in this set: its check is unchanged. */
const LENIENT_WHEN_UNCHANGED = new Set(["tan", "gumasta", "agriculture", "horticulture"]);

const SELLER_LICENCES = [
  { key: "tan",          field: "tanNumber",          file: "tanCertificate",          docType: "tan",          label: "TAN Certificate",
    re: /^[A-Z]{4}[0-9]{5}[A-Z]$/,
    hint: "TAN must be 10 characters — 4 letters, 5 digits, 1 letter (e.g. MUMA12345B)" },
  { key: "gumasta",      field: "gumastaNumber",      file: "gumastaCertificate",      docType: "gumasta",      label: "Gumasta / Shop Act Certificate", re: null },
  { key: "udyam",        field: "udyamNumber",        file: "udyamCertificate",        docType: "udyam",        label: "Udyam Certificate",
    re: /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/,
    hint: "Udyam number must look like UDYAM-MP-23-0001234" },
  { key: "agriculture",  field: "agricultureNumber",  file: "agricultureCertificate",  docType: "agriculture",  label: "Agriculture Licence", re: null },
  { key: "horticulture", field: "horticultureNumber", file: "horticultureCertificate", docType: "horticulture", label: "Horticulture Licence", re: null },
];

// A certificate scan has no business being larger than this. The shared
// uploadDocuments middleware caps every KYC upload at 10MB; this is the
// tighter limit for these five, applied here so the shared middleware — used
// by the PC document flow too — keeps its own limit.
const LICENCE_MAX_BYTES = 5 * 1024 * 1024;

/* docType → the name the documents list shows.

   The list normally renders each row's STORED label, which the profile upload
   always sets. This is the fallback for a row that has none — one uploaded
   through the Certifications screen (sellerDocumentController defaults the
   label to the raw filename), or any older row — so it reads
   "Gumasta / Shop Act Certificate" rather than "scan_final_v2.png".

   Built FROM SELLER_LICENCES rather than typed out again, so a licence can
   never be added to that list and forgotten here. */
const DOC_TYPE_LABELS = {
  gst: "GST Certificate",
  pan: "PAN Card",
  ...Object.fromEntries(SELLER_LICENCES.map((L) => [L.docType, L.label])),
};

/** Build the seller Profile response — identity + compliance + KYC docs (signed
 * at read-time). Shared by GET and PATCH so both return the same fresh shape. */
async function sellerProfilePayload(seller) {
  const sellerId = seller._id;
  const v = seller.verification || {};
  const contact = seller.contact || {};
  const addr = contact.address || {};
  const addressStr = [addr.line, addr.city, addr.state, addr.pincode].filter((x) => x && String(x).trim()).join(", ");

  // Formal docs: prefer the structured SellerDocument collection (gst/pan/…),
  // then fold in any legacy verification.docs[] string keys. Every file is
  // served via a SIGNED url resolved at read-time from its stored key.
  const docRows = await SellerDocument.find({ sellerId }).sort({ createdAt: -1 });
  const documents = await Promise.all(docRows.map(async (d) => ({
    _id: String(d._id), docType: d.docType, label: d.label || DOC_TYPE_LABELS[d.docType] || d.fileName || "Document",
    fileName: d.fileName, status: d.status, url: await fileService.signedUrl(d.fileKey),
  })));
  const legacy = (await Promise.all((v.docs || []).map(async (k, i) => ({
    _id: `legacy-${i}`, docType: "other", label: `Document ${i + 1}`, fileName: null, status: null,
    url: await fileService.publicFileUrl(k),
  })))).filter((d) => d.url);

  const urlByType = (type) => documents.find((d) => d.docType === type)?.url || null;
  const docByType = (type) => documents.find((d) => d.docType === type) || null;

  // Each licence's NUMBER (from the seller) beside its CERTIFICATE (from the
  // document rows). Every key is always present, with nulls when nothing has
  // been filled in, so the UI can render a fixed set of rows and show
  // "Not provided" rather than having to guess which ones exist.
  const lic = v.licences || {};

  /* UDYAM HAS TWO HOMES, AND THEY MUST AGREE.

     `verification.udyam` is filled at REGISTRATION; `verification.licences
     .udyam` is what the Other-registration-documents row writes. Read
     separately they disagreed — the licence row opened empty even though the
     seller had already given the number when signing up, and was asked to
     type it again.

     ONE value, resolved here: the licence row's own value when the seller has
     edited it, otherwise the registration one. The write path keeps both
     fields in step, so this fallback only ever matters for sellers who
     registered before the licence rows existed. */
  const udyamNumber = lic.udyam || v.udyam || "";

  const licences = Object.fromEntries(SELLER_LICENCES.map((L) => {
    const d = docByType(L.docType);
    return [L.key, {
      number: (L.key === "udyam" ? udyamNumber : lic[L.key]) || "",
      url: d?.url || null,
      fileName: d?.fileName || null,
      status: d?.status || null,
      documentId: d?._id || null,
    }];
  }));

  return {
    identity: {
      businessName: seller.sellerInfo?.businessName || "",
      contactPerson: contact.ownerName || "",
      email: contact.officialEmail || seller.email || "",
      phone: contact.officialPhone || seller.phone || "",
      address: addressStr,
    },
    compliance: {
      gstin: v.gstin || "",
      pan: v.pan || "",
      // The SAME number the licence row shows — see udyamNumber above.
      udyam: udyamNumber,
      gstCertificateUrl: urlByType("gst"),
      panFileUrl: urlByType("pan"),
      // The certificate uploaded against the Udyam licence row. This was
      // hard-coded null back when nothing could produce a udyam document; now
      // that the licence row uploads one, the compliance card can link to it
      // instead of reporting "Not provided" for a file that exists.
      udyamCertificateUrl: urlByType("udyam"),
    },
    licences,
    documents: [...documents, ...legacy],
  };
}

/** Store a multer (memory) file under a seller-scoped key and upsert a
 * SellerDocument of the given docType. For gst/pan we REPLACE the existing row
 * in place (so the compliance link points at the newest file and the doc list
 * doesn't grow); for "other" we always add a new row. Returns the doc. */
async function upsertSellerDoc(sellerId, docType, file, label, documentNumber) {
  const ext = (path.extname(file.originalname || "") || ".bin").toLowerCase();
  const key = `sellers/${sellerId}/documents/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const { url } = await fileService.uploadBuffer(file.buffer, key, file.mimetype);
  const fields = { fileKey: key, fileUrl: url, fileName: file.originalname, mimeType: file.mimetype, status: "pending", label: label || file.originalname, uploadedAt: new Date() };
  // Optional, and only for the licence types — gst/pan/other pass nothing and
  // the key never appears, so their rows are byte-for-byte what they were.
  if (documentNumber !== undefined) fields.documentNumber = documentNumber;
  if (docType === "other") return SellerDocument.create({ sellerId, docType, ...fields });
  const existing = await SellerDocument.findOne({ sellerId, docType }).sort({ createdAt: -1 });
  if (existing) { Object.assign(existing, fields); return existing.save(); }
  return SellerDocument.create({ sellerId, docType, ...fields });
}

/**
 * GET /api/seller/profile — the seller's full registration record for the
 * Profile page, mirroring the company's. The seller is resolved from the token
 * (req.user.sellerId), so a seller only ever sees its own documents.
 */
exports.getSellerProfile = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    if (!sellerId) return res.status(401).json({ success: false, message: "No seller in this session — please log in again" });

    const seller = await Seller.findById(sellerId).select("-passwordHash");
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found" });

    res.json({ success: true, data: await sellerProfilePayload(seller) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * PATCH /api/seller/profile — edit the OWN seller's identity + compliance and
 * replace KYC documents. Resolved from the token (req.user.sellerId); only that
 * seller's record + documents are touched. Files (multipart) replace the GST
 * certificate / PAN file (upserted SellerDocuments) and append other docs;
 * every file is stored as an S3 key and served signed.
 */
exports.updateSellerProfile = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    if (!sellerId) return res.status(401).json({ success: false, message: "No seller in this session — please log in again" });

    const seller = await Seller.findById(sellerId);
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found" });

    const b = req.body || {};
    seller.sellerInfo = seller.sellerInfo || {};
    seller.contact = seller.contact || {};
    seller.contact.address = seller.contact.address || {};
    seller.verification = seller.verification || {};

    // Identity
    if (b.businessName !== undefined) seller.sellerInfo.businessName = String(b.businessName).trim();
    if (b.contactPerson !== undefined) seller.contact.ownerName = String(b.contactPerson).trim();
    if (b.email !== undefined) {
      const v = String(b.email).trim();
      if (v && !isEmail(v)) return res.status(400).json({ success: false, message: "Enter a valid email address" });
      seller.contact.officialEmail = v;
    }
    if (b.phone !== undefined) {
      const v = String(b.phone).trim();
      if (v && !isPhone10(v)) return res.status(400).json({ success: false, message: "Phone must be a 10-digit number" });
      seller.contact.officialPhone = v;
    }
    if (b.address !== undefined) seller.contact.address.line = String(b.address).trim();

    // Compliance
    if (b.gstin !== undefined) {
      const v = String(b.gstin).trim().toUpperCase();
      if (v && !isGstin(v)) return res.status(400).json({ success: false, message: "Enter a valid 15-character GSTIN" });
      seller.verification.gstin = v;
    }
    if (b.pan !== undefined) {
      const v = String(b.pan).trim().toUpperCase();
      if (v && !isPan(v)) return res.status(400).json({ success: false, message: "Enter a valid 10-character PAN" });
      seller.verification.pan = v;
    }

    // OTHER REGISTRATION LICENCES — the numbers. Each is saved on its own, so
    // a seller can fill one licence today and another next month without the
    // untouched ones being cleared (only a field actually POSTED is written).
    seller.verification.licences = seller.verification.licences || {};
    for (const L of SELLER_LICENCES) {
      if (b[L.field] === undefined) continue;
      const value = String(b[L.field]).trim().toUpperCase();
      const stored = String(seller.verification.licences[L.key] || "").trim().toUpperCase();
      // Blank is always allowed — these are optional, and clearing one has to
      // stay possible.
      //
      // An UNCHANGED value is allowed through even when it fails the checks
      // below. The profile form re-posts every licence on every save, so a bad
      // number recorded before these rules existed would otherwise make the
      // whole page unsaveable — a seller could never fix their phone number
      // until they also fixed a licence they may not have to hand. Editing that
      // number brings it back under the rules immediately.
      const unchanged = value === stored && LENIENT_WHEN_UNCHANGED.has(L.key);
      if (value && !unchanged) {
        if (value.length > LICENCE_MAX_LEN) {
          return res.status(400).json({ success: false, message: `${L.label} number is too long (max ${LICENCE_MAX_LEN} characters)` });
        }
        if (L.re) {
          if (!L.re.test(value)) return res.status(400).json({ success: false, message: L.hint });
        } else {
          // No national format — sanity only (see the note above SELLER_LICENCES).
          if (value.length < LICENCE_MIN_LEN || !LICENCE_CHARS_RE.test(value)) {
            return res.status(400).json({ success: false, message: `${L.label}: ${LICENCE_CHARS_HINT}` });
          }
        }
      }
      seller.verification.licences[L.key] = value;
      // Udyam is ONE number wearing two hats: the registration field and the
      // licence row. Writing both keeps the Compliance card and the licence
      // row from ever showing different values for the same registration.
      if (L.key === "udyam") seller.verification.udyam = value;
    }

    await seller.save({ validateModifiedOnly: true });

    // Document replacements (after the field save so a bad file doesn't block fields)
    const files = req.files || {};
    if (files.gstCertificate?.[0]) await upsertSellerDoc(sellerId, "gst", files.gstCertificate[0], "GST Certificate");
    if (files.panFile?.[0]) await upsertSellerDoc(sellerId, "pan", files.panFile[0], "PAN Card");

    // …and their certificates. upsertSellerDoc REPLACES for every docType except
    // "other", so re-uploading a licence updates its one row instead of piling
    // up duplicates.
    for (const L of SELLER_LICENCES) {
      const f = files[L.file]?.[0];
      if (!f) continue;
      if (f.size > LICENCE_MAX_BYTES) {
        return res.status(400).json({ success: false, message: `${L.label} must be 5MB or smaller` });
      }
      await upsertSellerDoc(sellerId, L.docType, f, L.label, seller.verification.licences?.[L.key] || "");
    }
    if (files.otherDocs?.length) {
      for (const f of files.otherDocs) await upsertSellerDoc(sellerId, "other", f);
    }

    res.json({ success: true, message: "Profile updated", data: await sellerProfilePayload(seller) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || "Server error" });
  }
};

/* ================= ONBOARDING ================= */
// All step handlers update the AUTHENTICATED seller (scoped to
// req.user.sellerId — never a client-supplied id), mirroring the company's
// multi-step setup: info → contact → verification → review/submit.

/** PUT /onboarding/info — business profile. Business legal name + at least one
 * product category are required. Business type and year started are no longer
 * collected during onboarding, so they are only written when a caller actually
 * sends them (the schema keeps both optional). */
exports.updateSellerInfo = async (req, res) => {
  try {
    const { businessName, businessType, productCategories, yearStarted } = req.body;
    if (isBlank(businessName)) return res.status(400).json({ success: false, message: "Business legal name is required" });
    if (!Array.isArray(productCategories) || productCategories.filter((c) => !isBlank(c)).length === 0)
      return res.status(400).json({ success: false, message: "Select at least one product category" });
    if (yearStarted !== undefined && !isValidYear(yearStarted))
      return res.status(400).json({ success: false, message: "Enter a valid 4-digit year started" });

    const set = {
      "sellerInfo.businessName": businessName,
      "sellerInfo.productCategories": productCategories.filter((c) => !isBlank(c)),
    };
    if (businessType !== undefined) set["sellerInfo.businessType"] = businessType;
    if (yearStarted !== undefined) set["sellerInfo.yearStarted"] = yearStarted;

    const seller = await Seller.findByIdAndUpdate(
      req.user.sellerId,
      { $set: set },
      { new: true, runValidators: true },
    ).select("-passwordHash");
    if (!seller) return res.status(404).json({ message: "Seller not found" });
    res.json({ success: true, message: "Business info saved", data: publicSeller(seller) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** PUT /onboarding/contact — address + contact person. All fields required. */
exports.updateSellerContact = async (req, res) => {
  try {
    const { address = {}, ownerName, officialEmail, officialPhone } = req.body;
    if (isBlank(address.line)) return res.status(400).json({ success: false, message: "Address line is required" });
    if (isBlank(address.city)) return res.status(400).json({ success: false, message: "City is required" });
    if (isBlank(address.state)) return res.status(400).json({ success: false, message: "State is required" });
    if (!isPincode(address.pincode)) return res.status(400).json({ success: false, message: "Pincode must be 6 digits" });
    if (isBlank(ownerName)) return res.status(400).json({ success: false, message: "Owner name is required" });
    if (!isEmail(officialEmail)) return res.status(400).json({ success: false, message: "Enter a valid official email" });
    if (!isPhone10(officialPhone)) return res.status(400).json({ success: false, message: "Official phone must be 10 digits" });

    const set = {
      "contact.address.line": address.line,
      "contact.address.city": address.city,
      "contact.address.state": address.state,
      "contact.address.pincode": address.pincode,
      "contact.ownerName": ownerName,
      "contact.officialEmail": officialEmail,
      "contact.officialPhone": officialPhone,
    };

    const seller = await Seller.findByIdAndUpdate(
      req.user.sellerId,
      { $set: set },
      { new: true, runValidators: true },
    ).select("-passwordHash");
    if (!seller) return res.status(404).json({ message: "Seller not found" });
    res.json({ success: true, message: "Contact saved", data: publicSeller(seller) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** PUT /onboarding/verification — statutory ids + documents. GSTIN/PAN/Udyam
 * required (same policy as the company verification step). */
exports.updateSellerVerification = async (req, res) => {
  try {
    const { gstin, pan, udyam, docs } = req.body;
    if (isBlank(gstin)) return res.status(400).json({ success: false, message: "GSTIN is required" });
    if (isBlank(pan)) return res.status(400).json({ success: false, message: "PAN is required" });
    if (isBlank(udyam)) return res.status(400).json({ success: false, message: "Udyam number is required" });

    const set = {
      "verification.gstin": gstin,
      "verification.pan": pan,
      "verification.udyam": udyam,
    };
    if (docs !== undefined) set["verification.docs"] = docs;

    const seller = await Seller.findByIdAndUpdate(
      req.user.sellerId,
      { $set: set },
      { new: true, runValidators: true },
    ).select("-passwordHash");
    if (!seller) return res.status(404).json({ message: "Seller not found" });
    res.json({ success: true, message: "Verification saved", data: publicSeller(seller) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** POST /onboarding/submit — review/submit. The seller stays "pending" until
 * approved (mirrors the company approval gate); this only finalises the
 * profile and acknowledges submission. */
exports.submitSellerOnboarding = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.sellerId).select("-passwordHash");
    if (!seller) return res.status(404).json({ message: "Seller not found" });
    res.json({
      success: true,
      message: "Onboarding submitted — awaiting approval",
      data: publicSeller(seller),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ================= SUPPLYING-COMPANY STATUS (read-only) ================= */
//
// The old "request link → company approves link" step is GONE. A seller becomes
// authorized to sell a company's products only when that company ISSUES a
// Principal Certificate (see services/pcService + controller/Seller/sellerPc).
// `linkStatus` is now PC-derived (set by reconcileLink on issuance); the read
// below stays so seller pages can show a coarse "approved/awaiting" banner.

/**
 * GET /api/seller/link — the seller's current authorization state (active
 * supplying company + linkStatus, now driven by PC issuance).
 */
exports.getSellerLink = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.sellerId).select("supplyingCompanyId linkStatus linkRejectionReason linkRequestedAt linkDecidedAt linkApprovalAcknowledged");
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found" });

    let company = null;
    if (seller.supplyingCompanyId) {
      const c = await Company.findById(seller.supplyingCompanyId).select("companyInfo.companyName fullName");
      if (c) company = { _id: c._id, businessName: companyName(c) };
    }

    res.json({
      success: true,
      data: {
        linkStatus: seller.linkStatus,
        linkRejectionReason: seller.linkRejectionReason || null,
        linkRequestedAt: seller.linkRequestedAt || null,
        linkDecidedAt: seller.linkDecidedAt || null,
        linkApprovalAcknowledged: !!seller.linkApprovalAcknowledged,
        company,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/seller/ack-approval — the seller has SEEN the one-time "Linked to
 * Khetify" banner; don't show it again. Idempotent.
 */
exports.ackApproval = async (req, res) => {
  try {
    await Seller.updateOne({ _id: req.user.sellerId }, { $set: { linkApprovalAcknowledged: true } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   SELLER MEMBER PASSWORD RESET (email link)

   A seller team member — a Warehouse Manager, say — is a `User` row with
   `ownerType: "seller"`. The company member flow in
   controller/User/userController is hard-scoped to `ownerType: "company"`
   ("seller members reset via the seller portal"), and that portal flow did not
   exist, so a seller manager who forgot their password had no way back in.

   These two handlers are that flow. They are the company one rule for rule —
   same 1-hour TTL, same SHA-256-hashed token at rest, same generic reply on
   every path so the endpoint cannot be used to discover which emails are
   registered, same rollback if the mail fails — sharing the primitives through
   services/passwordResetService rather than copying them again.

   CHANGING YOUR PASSWORD WHILE SIGNED IN NEEDS NOTHING HERE: `POST
   /api/users/change-password` reads `User.findById(req.user.id)` and is not
   owner-scoped, and a seller member's token carries that same User id, so it
   already works for sellers exactly as it does for company members.
   ══════════════════════════════════════════════════════════════════════════ */

const passwordReset = require("../../services/passwordResetService");

/**
 * POST /api/seller/forgot-password  { email }   (public — no auth)
 *
 * Emails a one-time reset link to a SELLER TEAM MEMBER.
 */
exports.sellerForgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!email || !isEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }

    // The SAME reply whether the account was found, not found or disabled —
    // otherwise this endpoint becomes a way to enumerate registered emails.
    const genericResponse = {
      success: true,
      message: "If an account exists for that email, a reset link has been sent.",
    };

    // SELLER members only. A company member resetting here would silently
    // bypass the company flow, so the scope is explicit on both sides.
    const user = await User.findOne({ ownerType: "seller", email });
    if (!user || user.status === "disabled") return res.json(genericResponse);

    const { raw, hash, expiresAt } = passwordReset.newResetToken();
    user.resetPasswordToken = hash;
    user.resetPasswordExpires = expiresAt;
    await user.save();

    // `type=seller` tells the shared reset page to consume the token on the
    // SELLER endpoint. Without it the page keeps its existing company/member
    // behaviour untouched.
    const resetUrl = passwordReset.resetUrlFor(raw, "seller");

    try {
      await passwordReset.sendResetEmail({ to: email, resetUrl });
    } catch (mailErr) {
      // Roll back, so a failed send never leaves a live reset token behind.
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();
      console.error("sellerForgotPassword mail error:", mailErr);
      return res.status(500).json({
        success: false,
        message: "Could not send the reset email. Please try again later.",
      });
    }

    res.json(genericResponse);
  } catch (error) {
    console.error("sellerForgotPassword error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/seller/reset-password  { token, password }   (public — no auth)
 *
 * Consumes the emailed token and sets the new password. The token is matched by
 * its HASH and must still be unexpired; it is cleared on use, so a link works
 * exactly once.
 */
exports.sellerResetPassword = async (req, res) => {
  try {
    const rawToken = String(req.body.token || "").trim();
    const password = String(req.body.password || "").trim();

    if (!rawToken) {
      return res.status(400).json({ success: false, message: "Reset token is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({
      ownerType: "seller",
      resetPasswordToken: passwordReset.hashResetToken(rawToken),
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ success: false, message: "Reset link is invalid or has expired" });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    // One use only.
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ success: true, message: "Password reset successful. You can now log in." });
  } catch (error) {
    console.error("sellerResetPassword error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/seller/change-password  { currentPassword, newPassword }
 *
 * WHY THIS EXISTS RATHER THAN REUSING /api/users/change-password.
 *
 * That shared endpoint is scoped to the caller's own account and would have
 * suited a seller perfectly — but a seller token can never reach it.
 * middlewares/principalRouteGuard is an app-wide, defence-in-depth rule:
 *
 *     if (!isSellerRoute && isSeller) → 403 "Company access only"
 *
 * A `principalType: "seller"` token may ONLY touch /api/seller/*, so the call
 * was refused before it ever reached the handler. That guard is deliberate and
 * correct — it stops a token minted for one portal being replayed against the
 * other — so the endpoint moves into the seller namespace instead of the guard
 * being weakened.
 *
 * The RULES are the company handler's, unchanged: both fields required, at
 * least 6 characters, the new password must differ from the current one, and
 * the current one is verified with bcrypt before anything is written.
 *
 * TWO KINDS OF PRINCIPAL sign in to this portal, and each keeps its password in
 * a different collection:
 *   · a TEAM MEMBER (Warehouse Manager, staff) — a `User` row
 *   · the SELLER ACCOUNT itself (seller_admin) — the `Seller` row
 * A member's token carries a User `id` that differs from `sellerId`; for the
 * account itself the two are the same. Both are supported, so the page works
 * for whoever opens it.
 */
exports.sellerChangePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "").trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }
    if (newPassword === currentPassword.trim()) {
      return res.status(400).json({ success: false, message: "New password must be different from the current one" });
    }

    // WHICH RECORD HOLDS THIS PRINCIPAL'S PASSWORD — decided from the VERIFIED
    // token, never from anything the client sent.
    const isAccountItself = String(req.user.id) === String(req.user.sellerId);
    const account = isAccountItself
      ? await Seller.findById(req.user.id)
      : await User.findOne({ _id: req.user.id, ownerType: "seller", ownerId: req.user.sellerId });

    if (!account || !account.passwordHash) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    const ok = await bcrypt.compare(currentPassword.trim(), account.passwordHash);
    if (!ok) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }

    account.passwordHash = await bcrypt.hash(newPassword, 10);
    // Any outstanding reset link is void once the password changes by hand.
    account.resetPasswordToken = null;
    account.resetPasswordExpires = null;
    await account.save();

    // The existing token stays valid, so the user is not signed out — the same
    // behaviour the company Settings page describes on screen.
    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("sellerChangePassword error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ================= LIVE LOCATION CONSENT =================
 * PATCH /api/seller/location   { status: "granted"|"denied", latitude?, longitude?, accuracy? }
 *
 * Records what the seller answered when the portal asked for their live
 * location after registering / logging in. Denial is a normal, expected answer
 * and is stored as such — it is NOT an error, and nothing about the session or
 * the dashboard depends on it.
 *
 * OWNER ONLY. A seller team member (manager / warehouse staff) shares the
 * seller account's scope but is a different person in a different place;
 * writing their handset's position onto the seller account would quietly
 * replace the business's own location. Members are never asked (the portal
 * skips the prompt for them) and are refused here as well, so a stray call
 * cannot do it either.
 */
exports.updateSellerLocation = async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.user.sellerId)) {
      return res.status(403).json({ success: false, message: "Only the seller account can set its location" });
    }

    const patch = await buildLocationAccess(req.body);

    const seller = await Seller.findById(req.user.sellerId);
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found" });

    applyLocationAccess(seller, patch);
    await seller.save();

    res.json({ success: true, data: publicLocationAccess(seller.locationAccess) });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ success: false, message: error.status ? error.message : "Server error" });
  }
};

/**
 * POST /api/seller/location/preview   { latitude, longitude }
 *
 * Resolves coordinates to a readable address WITHOUT saving. Backs the
 * confirmation step so the seller can see which place was detected before any
 * of it is written to their account. Backing out here leaves no trace.
 *
 * Owner-only, matching the write — a team member cannot set the seller's
 * location, so there is nothing for them to preview either.
 */
exports.previewSellerLocation = async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.user.sellerId)) {
      return res.status(403).json({ success: false, message: "Only the seller account can set its location" });
    }

    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return res.status(400).json({ success: false, message: "latitude must be a number between -90 and 90" });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({ success: false, message: "longitude must be a number between -180 and 180" });
    }

    const address = await reverseGeocode(latitude, longitude);
    res.json({ success: true, data: { latitude, longitude, address: address || null } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};