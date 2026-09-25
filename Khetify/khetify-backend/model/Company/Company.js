const mongoose = require("mongoose");

const companySchema = new mongoose.Schema(
  {
    // BASIC AUTH DETAILS
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
    },
    number: {
      type: String,
    },
    password: {
      type: String,
      required: true,
    },

    // EMAIL VERIFIED. OTP-first registration से बना हर account यहाँ true लेकर
    // आता है — यह अनुमान नहीं, registration के वक़्त साबित हुई बात है.
    //
    // पुराने accounts पर यह field है ही नहीं, जो false पढ़ा जाता है — और वो
    // सही भी है: वे बिना OTP के बने थे.
    emailVerified: {
      type: Boolean,
      default: false,
    },

    // PHONE VERIFIED. emailVerified का जुड़वाँ, पर अलग सफ़र: email registration
    // के वक़्त सत्यापित होता है, phone बाद में profile से.
    //
    // हर मौजूदा account पर यह false है — और वो सही भी है, क्योंकि किसी ने
    // अभी तक अपना number सत्यापित किया ही नहीं. Hub का banner इसी पर टिका है.
    numberVerified: {
      type: Boolean,
      default: false,
    },

    // Short-lived OTP for verifying `number`. resetPasswordToken की तरह ही
    // यहीं Company पर रहता है — इसके लिए अलग collection बनाना ज़रूरत से
    // ज़्यादा होता, क्योंकि यह हमेशा एक मौजूदा account से ही जुड़ा होता है.
    // Hash रखा जाता है, कभी raw code नहीं.
    numberOtp: {
      codeHash: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
      lastSentAt: { type: Date, default: null },
      resendCount: { type: Number, default: 0 },
      // Jis number par code bheja gaya. Aksar `number` ke barabar hota hai,
      // par jab koi apna number BADAL kar verify kar raha ho to yahan naya
      // number rehta hai — aur verify hote hi wahi `number` ban jata hai.
      // Yahi tarika sahi hai: naya number tabhi account par aaye jab uska
      // maalik hona saabit ho jaye.
      pendingNumber: { type: String, default: null },
    },

    // STORED TOKEN
    token: {
      type: String,
      default: null,
    },

    // PASSWORD RESET (email link flow). Stores a SHA-256 hash of the raw token
    // that was emailed, never the raw token itself, plus its expiry.
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },

    // STATUS ENUM
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    subscription: {
      type: String,
      enum: ["free", "paid"],
      default: "free",
    },

    // COMPANY INFO
    companyInfo: {
      companyName: {
        type: String,
        trim: true,
      },
      businessType: {
        type: String,
        trim: true,
      },

      productCategory: [
        {
          type: {
            type: String,
            trim: true,
          },
          shortDescription: {
            type: String,
            trim: true,
          },
        },
      ],

      established: String,

      // ✅ NEW FIELDS ADDED
      companyLogo: {
        type: String,
      },
      coverImage: {
        type: String,
      },
      tagline: {
        type: String,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
      },
      location: {
        type: String,
        trim: true,
      },
      numberOfEmployees: {
        type: String,
      },
      productionCapacity: {
        type: String,
      },
      minimumOrderQuantity: {
        type: String,
      },

      // ✅ ARRAY FIELDS
      marketsServed: [
        {
          type: String,
        },
      ],
      certifications: [
        {
          type: String,
        },
      ],
      websiteLink: {
        type: String,
      },
    },

    // BUSINESS CONTACT
    businessContact: {
      address: String,
      region: String,
      authorizedPerson: String,
      businessEmail: String,
      businessNumber: String,
    },

    // COMPANY DOCUMENTS
    companyDocument: {
      gstinNumber: String,
      gstCertificate: String,
      udyamIncorporationNumber: {
        type: String,
      },
      udyamIncorporationCertificate: {
        type: String,
      },
      certificateNumber: String,
      panNumber: String,
      panFile: String,
    },

    // IMS SETTINGS (additive — existing companies default to the historical
    // behaviour: lot/batch numbers are supplied by the company)
    imsSettings: {
      // "company_defined"   → operator types the lot number manually
      // "khetify_generated" → system generates
      //                       KH-<COMPANY>-<PRODUCT CODE>-<YYYY>-<MM>-<SERIAL>
      // (The numbering choice is now made per-lot at Create Lot, not company-wide.)
      lotNumberingMethod: {
        type: String,
        enum: ["company_defined", "khetify_generated"],
        default: "company_defined",
      },
      // Legacy field, retained for backwards compatibility with existing
      // documents; unused now that the company-pattern feature was removed.
      lotNumberFormat: {
        type: String,
        default: "{WH}-{YYYY}{MM}-{SEQ}",
        maxlength: 80,
      },
    },
  },
  { timestamps: true },
);

// Add unique index on email — ensures email uniqueness at database level
companySchema.index({ email: 1 }, { unique: true, sparse: true });
// Add unique index on phone number — ensures phone uniqueness at database level
companySchema.index({ number: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Company", companySchema);
