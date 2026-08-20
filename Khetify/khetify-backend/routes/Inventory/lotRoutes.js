const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const requireWarehouseExists = require("../../middlewares/requireWarehouseExists");
const { FEATURES } = require("../../config/plans");
const { sellFefoBody, receiveBody, transferBody, receiveBoxBody } = require("../../validators/lotValidators");

const {
  getLots,
  receiveLot,
  transferLot,
  sellFefo,
  incomingLot,
  confirmLotReceipt,
  listBulkPackages,
  incomingBox,
  receiveBox,
  lotDetails,
  lotTransferSnapshot,
  availableUnits,
} = require("../../controller/Inventory/lotController");

// Reading lots: any logged-in company / inventory-reading role.
router.get("/", auth, authorize("lot:read"), getLots);
// Company Warehouse "Receive Lot" scan — resolve an exact pending parent lot.
router.get("/incoming", auth, authorize("lot:read"), incomingLot);
// Company Warehouse Confirm Receive — the only place pending qty becomes stock
// for a SINGLE-PACKAGE lot. A lot packed into boxes is refused here.
router.post("/:id/confirm-receipt", auth, authorize("lot:receive"), confirmLotReceipt);

// ── BULK PACKAGING ────────────────────────────────────────────────────────
// A lot's physical outer boxes: list them (labels/box list), resolve one from a
// scan, and receive one. Receiving a box is the box-by-box counterpart of
// confirm-receipt, so it sits behind the same "lot:receive" capability.
router.get("/:id/bulk-packages", auth, authorize("lot:read"), listBulkPackages);
// Read-only Lot Details page: everything about ONE lot in a single request.
router.get("/:id/details", auth, authorize("lot:read"), lotDetails);
// Read-only IMMUTABLE transfer snapshot: what this Company → Warehouse transfer
// looked like when it arrived (original qty + every minted unit + its boxes),
// unaffected by later movements. Powers Warehouse → Transfer History → View.
router.get("/:id/transfer-snapshot", auth, authorize("lot:read"), lotTransferSnapshot);
// Read-only: WHICH unit numbers make up this lot row's available quantity now.
// Powers Company → Analytics → Product Details → "View Available Units".
router.get("/:id/available-units", auth, authorize("lot:read"), availableUnits);
router.get("/incoming-box", auth, authorize("lot:read"), incomingBox);
router.post("/receive-box", auth, authorize("lot:receive"), validate({ body: receiveBoxBody }), receiveBox);

// FEFO selling deducts stock — sales-capable roles only.
router.post("/sell-fefo", auth, authorize("order:create"), validate({ body: sellFefoBody }), sellFefo);

// Premium: batch & expiry tracking (matches plans.js FEATURES).
router.post(
  "/receive",
  auth,
  authorize("lot:receive"),
  loadSubscription,
  requireFeature(FEATURES.BATCH_EXPIRY),
  // A lot must land in a warehouse: block creation until the company has one.
  requireWarehouseExists(),
  validate({ body: receiveBody }),
  receiveLot
);

// Premium: cross-warehouse movement.
router.post(
  "/transfer",
  auth,
  authorize("inventory:transfer"),
  loadSubscription,
  requireFeature(FEATURES.MULTI_WAREHOUSE),
  validate({ body: transferBody }),
  transferLot
);

module.exports = router;