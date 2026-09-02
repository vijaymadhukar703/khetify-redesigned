const Company = require("../../model/Company/Company")
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { isBlank, isEmail, isPhone10, isGstin, isPan, isValidYear } = require("../../utils/fieldValidators");
const fileService = require("../../services/fileService");
const { sendMail } = require("../../services/mailerService");
const path = require("path");

// Reset tokens live for 1 hour. Raw token is emailed; only its SHA-256 hash is
// persisted, so a DB read cannot be used to hijack an account.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const hashResetToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/* ================= PROFILE (registration details + KYC docs) ================= */

/** Build the Profile response for a company doc — identity + compliance + the
 * formal documents resolved to SIGNED (S3) / served URLs at read-time. Shared
 * by GET and PATCH so both return the exact same shape with fresh URLs. */
async function companyProfilePayload(company) {
  const info = company.companyInfo || {};
  const contact = company.businessContact || {};
  const docu = company.companyDocument || {};
  const [gstCertificateUrl, panFileUrl, udyamCertificateUrl] = await Promise.all([
    fileService.publicFileUrl(docu.gstCertificate),
    fileService.publicFileUrl(docu.panFile),
    fileService.publicFileUrl(docu.udyamIncorporationCertificate),
  ]);
  const certifications = (await Promise.all((info.certifications || []).map(async (c, i) => ({
    _id: `cert-${i}`, docType: "certification", label: `Certification ${i + 1}`, fileName: null, status: null,
    url: await fileService.publicFileUrl(c),
  })))).filter((c) => c.url);
  return {
    identity: {
      businessName: info.companyName || company.fullName || "",
      contactPerson: contact.authorizedPerson || company.fullName || "",
      email: contact.businessEmail || company.email || "",
      phone: contact.businessNumber || company.number || "",
      address: contact.address || info.location || "",
    },
    compliance: {
      gstin: docu.gstinNumber || "",
      pan: docu.panNumber || "",
      udyam: docu.udyamIncorporationNumber || "",
      gstCertificateUrl,
      panFileUrl,
      udyamCertificateUrl,
    },
    documents: certifications,
  };
}

/** Upload a multer (memory) file to storage (S3/local) under a deterministic
 * company-scoped key; returns the stored KEY (never a guessed public URL). */
async function storeCompanyDoc(companyId, file, slug) {
  const ext = (path.extname(file.originalname || "") || ".bin").toLowerCase();
  const key = `companies/${companyId}/${slug}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const { key: stored } = await fileService.uploadBuffer(file.buffer, key, file.mimetype);
  return stored;
}

/**
 * GET /api/company/profile — the company's full registration record. The
 * company is resolved from the VERIFIED TOKEN (req.user.companyId, falling back
 * to id for company-owner tokens) — never a client-supplied id or a missing
 * session field (which caused the old "No company id" failure).
 */
exports.getCompanyProfile = async (req, res) => {
  try {
    const companyId = req.user.companyId || req.user.id;
    if (!companyId) return res.status(401).json({ success: false, message: "No company in this session — please log in again" });

    const company = await Company.findById(companyId).select("-password -token");
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    res.json({ success: true, data: await companyProfilePayload(company) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * PATCH /api/company/profile — edit the OWN company's identity + compliance and
 * replace KYC documents. Owner resolved from the token; only that company's
 * record is touched. Files (multipart) replace gstCertificate / panFile and
 * append extra docs (stored as S3 keys, served signed). Saves with
 * validateModifiedOnly so unrelated legacy fields can't block the write.
 */
exports.updateCompanyProfile = async (req, res) => {
  try {
    const companyId = req.user.companyId || req.user.id;
    if (!companyId) return res.status(401).json({ success: false, message: "No company in this session — please log in again" });

    const company = await Company.findById(companyId);
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    const b = req.body || {};
    company.companyInfo = company.companyInfo || {};
    company.businessContact = company.businessContact || {};
    company.companyDocument = company.companyDocument || {};

    // Identity (the shared Profile UI sends `businessName`; `companyName` kept too)
    if (b.companyName !== undefined || b.businessName !== undefined) {
      company.companyInfo.companyName = String(b.companyName ?? b.businessName).trim();
    }
    if (b.contactPerson !== undefined) company.businessContact.authorizedPerson = String(b.contactPerson).trim();
    if (b.email !== undefined) {
      const v = String(b.email).trim();
      if (v && !isEmail(v)) return res.status(400).json({ success: false, message: "Enter a valid email address" });
      company.businessContact.businessEmail = v;
    }
    if (b.phone !== undefined) {
      const v = String(b.phone).trim();
      if (v && !isPhone10(v)) return res.status(400).json({ success: false, message: "Phone must be a 10-digit number" });
      company.businessContact.businessNumber = v;
    }
    if (b.address !== undefined) company.businessContact.address = String(b.address).trim();

    // Compliance (validate format only when a non-blank value is supplied)
    if (b.gstin !== undefined) {
      const v = String(b.gstin).trim().toUpperCase();
      if (v && !isGstin(v)) return res.status(400).json({ success: false, message: "Enter a valid 15-character GSTIN" });
      company.companyDocument.gstinNumber = v;
    }
    if (b.pan !== undefined) {
      const v = String(b.pan).trim().toUpperCase();
      if (v && !isPan(v)) return res.status(400).json({ success: false, message: "Enter a valid 10-character PAN" });
      company.companyDocument.panNumber = v;
    }

    // Document replacements (multipart fields)
    const files = req.files || {};
    if (files.gstCertificate?.[0]) company.companyDocument.gstCertificate = await storeCompanyDoc(companyId, files.gstCertificate[0], "gst");
    if (files.panFile?.[0]) company.companyDocument.panFile = await storeCompanyDoc(companyId, files.panFile[0], "pan");
    if (files.otherDocs?.length) {
      const keys = await Promise.all(files.otherDocs.map((f) => storeCompanyDoc(companyId, f, "doc")));
      company.companyInfo.certifications = [...(company.companyInfo.certifications || []), ...keys];
    }

    await company.save({ validateModifiedOnly: true });
    res.json({ success: true, message: "Profile updated", data: await companyProfilePayload(company) });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/* ================= REGISTER ================= */
exports.registerCompany = async (req, res) => {
  try {
    const { fullName, email, number, password } = req.body;

    // Every field is required. (Defense in depth — the UI blocks blank submits
    // too.) Full name must be non-blank; email AND phone number are BOTH
    // mandatory (not either/or) and must each pass format validation; and a
    // password of at least 6 characters.
    if (isBlank(fullName)) {
      return res.status(400).json({ message: "Full name is required" });
    }
    if (isBlank(email)) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }
    if (isBlank(number)) {
      return res.status(400).json({ message: "Phone number is required" });
    }
    if (!isPhone10(number)) {
      return res.status(400).json({ message: "Phone number must be 10 digits" });
    }
    if (isBlank(password) || String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check existing company
    const query = [];
    if (email) query.push({ email });
    if (number) query.push({ number });

    const existing = await Company.findOne({ $or: query });

    if (existing) {
      return res.status(400).json({ message: "Company already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create company
    const company = new Company({
      fullName,
      email: email || null,
      number: number || null,
      password: hashedPassword,
      status: "pending",
    });

    await company.save();

    // Generate JWT. Company-owner tokens carry companyId === id and the
    // company_admin role so authorize()/RBAC works without a separate login.
    const token = jwt.sign(
      { id: company._id, companyId: company._id, role: "company_admin" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "Company registered successfully",
      token,
      company: {
        _id: company._id,
        fullName: company.fullName,
        email: company.email,
        status: company.status,
        subscription: company.subscription,
      },
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


/* ================= LOGIN ================= */
exports.loginCompany = async (req, res) => {
  try {
    const { email, number, password } = req.body;

    const query = [];

    if (email) query.push({ email: email.toLowerCase().trim() });
    if (number) query.push({ number: String(number).trim() });

    if (!password || query.length === 0) {
      return res
        .status(400)
        .json({ message: "Email/Number and password required" });
    }

    const company = await Company.findOne({ $or: query });

    if (!company) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password.trim(), company.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: company._id, companyId: company._id, role: "company_admin" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    company.token = token;
    // Last-login token refresh only — validate ONLY the modified field so a
    // legacy/stale value elsewhere on the document (e.g. a removed enum value
    // saved before a schema change) can never block sign-in.
    await company.save({ validateModifiedOnly: true });

    res.json({
      message: "Login successful",
      token,
      status: company.status,
      company: {
        id: company._id,
        fullName: company.fullName,
        email: company.email,
        number: company.number,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ================= FORGOT PASSWORD (email reset link) ================= */
exports.forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!email || !isEmail(email)) {
      return res.status(400).json({ message: "A valid email is required" });
    }

    const company = await Company.findOne({ email });

    // Always respond the same way so this endpoint can't be used to discover
    // which emails are registered (account enumeration).
    const genericResponse = {
      message: "If an account exists for that email, a reset link has been sent.",
    };

    if (!company) return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString("hex");
    company.resetPasswordToken = hashResetToken(rawToken);
    company.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await company.save({ validateModifiedOnly: true });

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    try {
      await sendMail({
        to: email,
        subject: "Reset your Khetify password",
        text: `We received a request to reset your Khetify password.\n\nOpen this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
        html: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#EA2831">Khetify</h2>
            <p>We received a request to reset your password.</p>
            <p>
              <a href="${resetUrl}" style="display:inline-block;background:#EA2831;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Reset Password</a>
            </p>
            <p style="color:#666;font-size:13px">This link is valid for 1 hour. If you didn't request a reset, ignore this email.</p>
            <p style="color:#999;font-size:12px">Or paste this link into your browser:<br/>${resetUrl}</p>
          </div>`,
      });
    } catch (mailErr) {
      // Roll back the token so a failed send doesn't leave a dangling reset.
      company.resetPasswordToken = null;
      company.resetPasswordExpires = null;
      await company.save({ validateModifiedOnly: true });
      return res.status(502).json({ message: "Could not send the reset email. Please try again later." });
    }

    res.json(genericResponse);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ================= RESET PASSWORD (consume email token) ================= */
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Reset token is required" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const company = await Company.findOne({
      resetPasswordToken: hashResetToken(token),
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!company) {
      return res.status(400).json({ message: "Reset link is invalid or has expired" });
    }

    company.password = await bcrypt.hash(String(password).trim(), 10);
    company.resetPasswordToken = null;
    company.resetPasswordExpires = null;
    company.token = null; // invalidate any existing session token
    await company.save({ validateModifiedOnly: true });

    res.json({ message: "Password reset successful. You can now log in." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ================= GET ALL ================= */
exports.getAllCompanies = async (req, res) => {
  try {
    const companies = await Company.find().select("-password");
    res.json(companies);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ================= GET BY ID ================= */
exports.getCompanyById = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).select("-password");
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
exports.updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {};

    // ── REQUIRED-FIELD VALIDATION (onboarding, defense in depth) ──
    // This endpoint is SHARED: onboarding steps, the status-only submit, and
    // profile edits all use it with partial bodies. So we validate only the
    // fields a request actually submits — every required field that IS sent
    // must be non-blank/valid (onboarding steps send their whole section, so a
    // blank field there is rejected). We never force unrelated sections to be
    // present, which keeps the status-only submit + partial edits working.
    {
      const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
      const reject = (message) => res.status(400).json({ success: false, message });

      if (req.body.companyInfo !== undefined) {
        const ci = parse(req.body.companyInfo) || {};
        if (ci.companyName !== undefined && isBlank(ci.companyName)) return reject("Company name is required");
        if (ci.businessType !== undefined && isBlank(ci.businessType)) return reject("Business type is required");
        if (ci.established !== undefined && (isBlank(ci.established) || !isValidYear(ci.established)))
          return reject("Enter a valid 4-digit year of establishment");
      }

      if (req.body.businessContact !== undefined) {
        const bc = parse(req.body.businessContact) || {};
        if (bc.address !== undefined && isBlank(bc.address)) return reject("Business address is required");
        if (bc.region !== undefined && isBlank(bc.region)) return reject("Operating region is required");
        if (bc.authorizedPerson !== undefined && isBlank(bc.authorizedPerson)) return reject("Authorized person is required");
        if (bc.businessEmail !== undefined && !isEmail(bc.businessEmail)) return reject("Enter a valid official email");
        if (bc.businessNumber !== undefined && !isPhone10(bc.businessNumber)) return reject("Official phone must be 10 digits");
      }

      // Verification ids arrive as top-level body keys (multipart form).
      if (req.body.gstinNumber !== undefined && isBlank(req.body.gstinNumber)) return reject("GSTIN is required");
      if (req.body.udyamIncorporationNumber !== undefined && isBlank(req.body.udyamIncorporationNumber)) return reject("Udyam/Incorporation number is required");
      if (req.body.panNumber !== undefined && isBlank(req.body.panNumber)) return reject("PAN number is required");
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 BASIC INFO
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.body.fullName) updateData["fullName"] = req.body.fullName;
    if (req.body.email) updateData["email"] = req.body.email;
    if (req.body.number) updateData["number"] = req.body.number;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 COMPANY INFO (text fields)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.body.companyInfo) {
      const companyInfo =
        typeof req.body.companyInfo === "string"
          ? JSON.parse(req.body.companyInfo)
          : req.body.companyInfo;

      const allowedFields = [
        "companyName",
        "businessType",
        "established",
        "tagline",
        "description",
        "location",
        "numberOfEmployees",
        "productionCapacity",
        "minimumOrderQuantity",
        "websiteLink",
      ];

      allowedFields.forEach((key) => {
        if (companyInfo[key] !== undefined) {
          updateData[`companyInfo.${key}`] = companyInfo[key];
        }
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 PRODUCT CATEGORY ARRAY
    // [{ type: "Electronics", shortDescription: "..." }]
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.body.productCategory) {
      const productCategory =
        typeof req.body.productCategory === "string"
          ? JSON.parse(req.body.productCategory)
          : req.body.productCategory;
      updateData["companyInfo.productCategory"] = productCategory;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 MARKETS SERVED ARRAY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.body.marketsServed) {
      const marketsServed =
        typeof req.body.marketsServed === "string"
          ? JSON.parse(req.body.marketsServed)
          : req.body.marketsServed;
      updateData["companyInfo.marketsServed"] = marketsServed;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 BUSINESS CONTACT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.body.businessContact) {
      const businessContact =
        typeof req.body.businessContact === "string"
          ? JSON.parse(req.body.businessContact)
          : req.body.businessContact;

      Object.keys(businessContact).forEach((key) => {
        updateData[`businessContact.${key}`] = businessContact[key];
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 COMPANY DOCUMENT TEXT FIELDS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.body.gstinNumber)
      updateData["companyDocument.gstinNumber"] = req.body.gstinNumber;

    if (req.body.udyamIncorporationNumber)
      updateData["companyDocument.udyamIncorporationNumber"] =
        req.body.udyamIncorporationNumber;

    if (req.body.certificateNumber)
      updateData["companyDocument.certificateNumber"] =
        req.body.certificateNumber;

    if (req.body.panNumber)
      updateData["companyDocument.panNumber"] = req.body.panNumber;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 DOCUMENT FILE UPLOADS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.files?.gstCertificate) {
      updateData["companyDocument.gstCertificate"] =
        req.files.gstCertificate[0].path;
    }

    if (req.files?.registrationCertificate) {
      updateData["companyDocument.udyamIncorporationCertificate"] =
        req.files.registrationCertificate[0].path;
    }

    if (req.files?.panCard) {
      updateData["companyDocument.panFile"] = req.files.panCard[0].path;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 COMPANY LOGO (single image)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.files?.companyLogo) {
      updateData["companyInfo.companyLogo"] = req.files.companyLogo[0].path;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 COVER IMAGE (single image)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (req.files?.coverImage) {
      updateData["companyInfo.coverImage"] = req.files.coverImage[0].path;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 CERTIFICATIONS (multiple images)
    // Add new + Remove old support
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const hasNewCerts = req.files?.certifications?.length > 0;
    const hasRemovedCerts = req.body.removedCertifications;

    if (hasNewCerts || hasRemovedCerts) {
      const existingCompany = await Company.findById(id);
      if (!existingCompany) {
        return res.status(404).json({
          success: false,
          message: "Company not found",
        });
      }

      let currentCertifications = [
        ...(existingCompany.companyInfo?.certifications || []),
      ];

      // Purani certs remove karo
      if (hasRemovedCerts) {
        const removedCertifications =
          typeof req.body.removedCertifications === "string"
            ? JSON.parse(req.body.removedCertifications)
            : req.body.removedCertifications;

        currentCertifications = currentCertifications.filter(
          (cert) => !removedCertifications.includes(cert),
        );
      }

      // Nayi certs add karo
      if (hasNewCerts) {
        const newCerts = req.files.certifications.map((file) => file.path);
        currentCertifications = [...currentCertifications, ...newCerts];
      }

      updateData["companyInfo.certifications"] = currentCertifications;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔹 FINAL UPDATE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const updatedCompany = await Company.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true },
    ).select("-password");

    if (!updatedCompany) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Company updated successfully",
      data: updatedCompany,
    });
  } catch (error) {
    console.error("Update Company Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ================= IMS SETTINGS (lot numbering, ...) ================= */

/**
 * GET /api/company/settings/ims — read the tenant's IMS settings.
 * Scoped to the authenticated company (req.user.companyId), never a client id.
 */
exports.getImsSettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId).select("imsSettings");
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    res.json({
      success: true,
      data: {
        lotNumberingMethod: company.imsSettings?.lotNumberingMethod || "company_defined",
        lotNumberFormat: company.imsSettings?.lotNumberFormat || "{WH}-{YYYY}{MM}-{SEQ}",
      },
    });
  } catch (error) {
    console.error("Get IMS Settings Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/company/settings/ims  { lotNumberingMethod }
 * Owner-only (authorize("company:settings") on the route). Existing lot
 * records are never touched — the setting only affects future lot creation.
 */
exports.updateImsSettings = async (req, res) => {
  try {
    const { lotNumberingMethod } = req.body;
    if (!["company_defined", "khetify_generated"].includes(lotNumberingMethod)) {
      return res.status(400).json({
        success: false,
        message: "lotNumberingMethod must be 'company_defined' or 'khetify_generated'",
      });
    }

    const company = await Company.findByIdAndUpdate(
      req.user.companyId,
      { $set: { "imsSettings.lotNumberingMethod": lotNumberingMethod } },
      { new: true, runValidators: true },
    ).select("imsSettings");
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    const audit = require("../../services/auditService");
    await audit.log({
      req,
      action: "company.ims_settings_updated",
      entityType: "Company",
      entityId: req.user.companyId,
      after: { lotNumberingMethod },
    });
    res.json({
      success: true,
      message: "IMS settings updated",
      data: {
        lotNumberingMethod: company.imsSettings.lotNumberingMethod,
        // kept for response-shape compatibility (unused; numbering is now per-lot)
        lotNumberFormat: company.imsSettings.lotNumberFormat,
      },
    });
  } catch (error) {
    console.error("Update IMS Settings Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};