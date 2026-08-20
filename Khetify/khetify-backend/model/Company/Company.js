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
      }
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

module.exports = mongoose.model("Company", companySchema);
