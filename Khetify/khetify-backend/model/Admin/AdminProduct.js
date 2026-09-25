const mongoose = require("mongoose");
const Product = require("../Company/productModel");

/**
 * ADMIN PRODUCT LIBRARY — products the platform admin curates, kept in their
 * OWN collection ("admin_products").
 *
 * The schema is a CLONE of the Product schema, so the catalog fields, variants
 * and the product_code pre("validate") hook are identical — the hook runs with
 * `this.constructor === AdminProduct`, so codes are checked for uniqueness
 * inside admin_products. The Product model and collection are never touched.
 *
 * Ownership fields (companyId / ownerType / sellerId) do not apply here; the
 * company a library product belongs to is recorded as plain text instead.
 */
const schema = Product.schema.clone(); // same fields + product_code hook
// Clone the nested schema explicitly: shared Product variants stay unchanged.
const adminVariant = Product.schema.path('variants').schema.clone();
const measurementsSchema = require("../variantMeasurementsSchema");
adminVariant.add({ measurements: { type: measurementsSchema, default: undefined } });
schema.path('variants', [adminVariant]);
schema.remove(["companyId", "ownerType", "sellerId"]);
schema.add({
  companyName: { type: String, trim: true, required: true },
  legalName: { type: String, trim: true, required: true },
  licNo: { type: String, trim: true, default: "" },
  cinNo: { type: String, trim: true, uppercase: true, default: "" },
  createdByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
});

module.exports = mongoose.models.AdminProduct || mongoose.model("AdminProduct", schema, "admin_products");
