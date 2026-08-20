const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
// The SAME memory-storage multer used by seller KYC documents (PDF + images,
// 10MB). Reused rather than re-declared so the accepted types stay in one place.
const uploadDocuments = require("../../middlewares/uploadDocuments");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");

const {
  createSupplyOrder,
  getSupplyOrders,
  getSourceOptions,
  getPendingCount,
  updateSupplyStatus,
  pickSupplyOrder,
  packSupplyOrder,
  getManifest,
  dispatchSupplyOrder,
  getSupplyOrderDetails,
} = require("../../controller/Supply/supplyController");

// COMPANY WAREHOUSE → SELLER transfer (warehouse-initiated, scan-verified).
// Same supply rails, opposite direction of initiative — see
// services/companySellerTransferService.js.
const {
  getTransferOptions,
  getWarehouseProducts,
  getTransferBoxes,
  getTransferDocuments,
  getTransferPrefill,
  scanTransferItem,
  getTransferHistory,
  confirmTransfer,
} = require("../../controller/Company/companySellerTransferController");

// Entire supply workflow is a premium feature.
router.use(auth, loadSubscription, requireFeature(FEATURES.SUPPLY_WORKFLOW));

// ── COMPANY WAREHOUSE → SELLER TRANSFER ───────────────────────────────────
// Declared BEFORE the "/:id/..." routes so "transfer" is never read as an id.
// Guarded by inventory:transfer — the capability the warehouse→warehouse lot
// transfer already uses, which company_admin is explicitly denied (stock is
// moved by the warehouse that holds it). Reads are behind the same capability
// because they exist only to serve this screen.
router.get("/transfer/options", authorize("inventory:transfer"), getTransferOptions);
router.get("/transfer/history", authorize("inventory:transfer"), getTransferHistory);
router.get("/transfer/products", authorize("inventory:transfer"), getWarehouseProducts);
router.get("/transfer/:id/boxes", authorize("inventory:transfer"), getTransferBoxes);
router.get("/transfer/:id/documents", authorize("inventory:transfer"), getTransferDocuments);
router.get("/transfer/:id/prefill", authorize("inventory:transfer"), getTransferPrefill);
router.post("/transfer/scan", authorize("inventory:transfer"), scanTransferItem);
// Accepts multipart/form-data so the challan / bill / bilty copies can ride
// along with the transfer. A plain JSON body (no files) still works unchanged —
// multer passes it straight through.
router.post(
  "/transfer",
  authorize("inventory:transfer"),
  uploadDocuments.fields([
    { name: "challanDocument", maxCount: 1 },
    { name: "billDocument", maxCount: 1 },
    { name: "biltyDocument", maxCount: 1 },
  ]),
  confirmTransfer,
);

router.post("/", createSupplyOrder);
router.get("/", getSupplyOrders); // ?stage=pick|pack|dispatch narrows to a Send Stock tab
router.get("/pending-count", getPendingCount); // company Home widget
router.get("/:id/source-options", getSourceOptions); // per-warehouse availability for "Assign a source warehouse"
// READ-ONLY detail: parent lots + the exact child serials picked. Kept off the
// list endpoint so the list stays light; fetched only on View Details.
router.get("/:id/details", getSupplyOrderDetails);
router.put("/:id/status", updateSupplyStatus);
// Direct pick/pack/dispatch on the supply order (no PickList/wave).
router.post("/:id/pick", pickSupplyOrder);
router.post("/:id/pack", packSupplyOrder);
router.get("/:id/manifest", getManifest); // ensure planned shipment + token for the label barcode
router.post("/:id/dispatch", dispatchSupplyOrder);

module.exports = router;