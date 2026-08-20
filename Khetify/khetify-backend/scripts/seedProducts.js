/**
 * seedProducts.js — insert 5 real products into the database under a company.
 *
 * Run from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/seedProducts.js                      # defaults to admin@gmail.com
 *   node scripts/seedProducts.js --email=admin@gmail.com
 *   node scripts/seedProducts.js --company=<companyId>
 *
 * Safe to re-run: each product is upserted by { companyId, skuNumber }, so a
 * second run updates the same 5 rows instead of creating duplicates. Products
 * are created as live (active + uploaded) so they show in the Product Catalog.
 *
 * Note: manufacturing/expiry are tracked per LOT (not on the product), so this
 * script does not set them. Stock comes from lots too; availableStock starts 0.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const { generateUniqueProductCode } = require("../services/productCodeService");

// 5 realistic agri-input products for Khetify.
const PRODUCTS = [
  {
    productName: "Hybrid Tomato Seeds",
    brandName: "Khetify Seeds",
    category: "Seeds",
    unitType: "Packet",
    unit: "50 g",
    packagingType: "Pouch",
    skuNumber: "SEED-TOM-01",
    hsnCode: "1209",
    mrp: 120,
    costPrice: 78,
    gstPercentage: 5,
    minimumOrderQuantity: 10,
    countryOrigin: "India",
    shelfLife: "24 Months",
    qualityGrade: "standard",
    description: "High-germination hybrid tomato seeds suited for kharif and rabi sowing.",
    storageInstructions: "Store in a cool, dry place away from direct sunlight.",
    bulkPackaging: { type: "Carton", capacity: 100, capacityUnit: "packets" },
  },
  {
    productName: "Organic NPK Fertilizer 50kg",
    brandName: "GreenGro",
    category: "Fertilizers",
    unitType: "Bag",
    unit: "50 kg",
    packagingType: "Bag",
    skuNumber: "FERT-NPK-01",
    hsnCode: "3105",
    mrp: 1100,
    costPrice: 860,
    gstPercentage: 5,
    minimumOrderQuantity: 5,
    countryOrigin: "India",
    shelfLife: "36 Months",
    qualityGrade: "premium",
    description: "Balanced organic NPK granules for all-round crop nutrition.",
    storageInstructions: "Keep bags sealed and off the ground in a dry godown.",
    bulkPackaging: { type: "Sack", capacity: 1, capacityUnit: "bag" },
  },
  {
    productName: "Neem Bio Pesticide 1L",
    brandName: "NeemShield",
    category: "Pesticides",
    unitType: "Bottle",
    unit: "1 L",
    packagingType: "Bottle",
    skuNumber: "PEST-NEEM-01",
    hsnCode: "3808",
    mrp: 450,
    costPrice: 300,
    gstPercentage: 18,
    minimumOrderQuantity: 12,
    countryOrigin: "India",
    shelfLife: "24 Months",
    qualityGrade: "standard",
    description: "Cold-pressed neem oil bio-pesticide; safe for organic farming.",
    storageInstructions: "Store below 30°C, away from food and feed.",
    safetyInstructions: "Keep out of reach of children. Wear gloves while handling.",
    bulkPackaging: { type: "Carton", capacity: 12, capacityUnit: "bottles" },
  },
  {
    productName: "Zinc Sulphate Granules 25kg",
    brandName: "MicroNutri",
    category: "Micronutrients",
    unitType: "Bag",
    unit: "25 kg",
    packagingType: "Bag",
    skuNumber: "MICRO-ZN-01",
    hsnCode: "3105",
    mrp: 600,
    costPrice: 470,
    gstPercentage: 12,
    minimumOrderQuantity: 4,
    countryOrigin: "India",
    shelfLife: "36 Months",
    qualityGrade: "standard",
    description: "Zinc sulphate micronutrient to correct zinc deficiency in soil.",
    storageInstructions: "Store in a dry place; protect from moisture.",
    bulkPackaging: { type: "Sack", capacity: 1, capacityUnit: "bag" },
  },
  {
    productName: "Urea Fertilizer 45kg",
    brandName: "Kisan",
    category: "Fertilizers",
    unitType: "Bag",
    unit: "45 kg",
    packagingType: "Bag",
    skuNumber: "FERT-UREA-01",
    hsnCode: "3102",
    mrp: 270,
    costPrice: 240,
    gstPercentage: 5,
    minimumOrderQuantity: 10,
    countryOrigin: "India",
    shelfLife: "24 Months",
    qualityGrade: "standard",
    description: "Nitrogen-rich urea (46% N) for vegetative crop growth.",
    storageInstructions: "Keep dry; urea is hygroscopic and cakes when damp.",
    bulkPackaging: { type: "Sack", capacity: 1, capacityUnit: "bag" },
  },
];

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function resolveCompany(args) {
  if (args.company) {
    const c = await Company.findById(args.company);
    if (!c) throw new Error(`No company with id ${args.company}`);
    return c;
  }
  const email = args.email || "admin@gmail.com";
  const c = await Company.findOne({ email });
  if (!c) {
    throw new Error(
      `No company found with email "${email}". Register that company first, ` +
      `or pass --email=<the registered email> / --company=<companyId>.`
    );
  }
  return c;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const company = await resolveCompany(args);
    const companyId = company._id;
    console.log(`🏢 Company: ${company.email || company._id} (${company._id})`);

    for (const p of PRODUCTS) {
      await Product.updateOne(
        { companyId, skuNumber: p.skuNumber },
        {
          $set: {
            ...p,
            companyId,
            variantType: "single",
            availableStock: 0,        // stock is created per lot, not on the product
            productStatus: "active",
            productUpload: "uploaded",
          },
          // An upsert bypasses document middleware, so the schema hook can't
          // assign the code — do it here. $setOnInsert leaves an already-seeded
          // product's existing code alone.
          $setOnInsert: { product_code: await generateUniqueProductCode(p.productName) },
        },
        { upsert: true }
      );
      console.log(`  ✓ ${p.productName}  [${p.skuNumber}]`);
    }

    const count = await Product.countDocuments({ companyId, productUpload: "uploaded" });
    console.log(`\n📦 Done. ${PRODUCTS.length} products upserted. Company now has ${count} live product(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ seedProducts failed:", err.message);
    process.exit(1);
  });
