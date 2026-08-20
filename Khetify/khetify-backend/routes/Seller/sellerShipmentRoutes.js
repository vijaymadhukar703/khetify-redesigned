const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Seller/sellerShipmentController");
const wh = require("../../controller/Seller/sellerWarehouseTransferController");
// The delivery challan may be an image OR a PDF, of any size, so it rides the
// UNRESTRICTED uploader — the same one the company warehouse transfer and the
// seller New Transfer form already use. The shared document uploader is
// deliberately NOT reused: it caps at 10MB and filters types for the
// KYC/agreement routes, and loosening it would loosen those too.
const uploadChallan = require("../../middlewares/uploadAny");

// Seller shipments (supply + inter-warehouse transfers). Approved sellers only.
// Reads need transfer:read; dispatch + scan-receive need transfer:create
// (seller_admin "*" / seller_manager "transfer:*").
router.use(auth, requireApprovedSeller);
router.get("/", authorize("transfer:read"), ctrl.list);
router.get("/:id", authorize("transfer:read"), ctrl.get);
// Seller scan validation (Phase 3 Part 1). Read-only: resolves a scanned label
// against the database. Reserves and deducts nothing — /pick still does that.
router.get("/:id/scan-state", authorize("transfer:read"), ctrl.scanState);
router.post("/:id/scan", authorize("transfer:create"), ctrl.scan);
// Confirm a pick from validated scan tokens; re-checked server-side before any
// stock is touched. The legacy /pick route below is untouched.
router.post("/:id/scan-pick", authorize("transfer:create"), ctrl.scanPick);
router.post("/:id/pick", authorize("transfer:create"), ctrl.pick); // scan-to-pick (Send Stock)
router.post("/:id/pack", authorize("transfer:create"), ctrl.pack); // pack a fully-picked shipment
// SELLER ORDER PROCESSING — one flow, one write.
// Scanning and box building save NOTHING; `box-label` only previews a label.
// `dispatch-order` is the single call that picks, packs, boxes and dispatches,
// and it rolls its parcels back if the dispatch itself fails.
router.get("/:id/box", authorize("transfer:read"), ctrl.getBox);
router.post("/:id/box-label", authorize("transfer:create"), ctrl.boxLabelPreview);
router.get("/:id/delivery-label", authorize("transfer:read"), ctrl.deliveryLabel);
router.post("/:id/dispatch-order", authorize("transfer:create"), ctrl.dispatchOrder);
router.get("/:id/manifest", authorize("transfer:create"), ctrl.manifest); // print label before dispatch
router.post("/:id/dispatch", authorize("transfer:create"), ctrl.dispatch);
router.post("/:id/receive", authorize("transfer:create"), ctrl.receive);

// ── SELLER WAREHOUSE → WAREHOUSE TRANSFER ──────────────────────────────────
// The seller mirror of the company transfer endpoints (dispatch-checklist /
// dispatch-scan / repack-boxes / dispatch / receive-checklist / receive-scan /
// receive-units). STRICTLY ADDITIVE: every route above is untouched, so the
// SELLER → CUSTOMER order flow (/scan, /scan-pick, /box-label, /dispatch-order,
// /delivery-label) behaves exactly as it did.
//
// These paths all carry a second segment, so none of them can ever be captured
// by the single-segment "/:id" route declared above.
router.get("/:id/transfer-checklist", authorize("transfer:read"), wh.checklist);
router.post("/:id/transfer-scan", authorize("transfer:create"), wh.scan);
// Boxing: tick scanned units → one box, and undo a box before dispatch.
router.get("/:id/transfer-boxes", authorize("transfer:read"), wh.boxes);
router.post("/:id/transfer-box", authorize("transfer:create"), wh.packBox);
router.post("/:id/transfer-box/discard", authorize("transfer:create"), wh.discardBox);
// Closing the transfer without dispatching: every DRAFT box is discarded and
// its units become loose stock again. A box is only permanent once dispatched.
router.post("/:id/transfer-abandon", authorize("transfer:create"), wh.abandon);
// The single call that moves stock — it re-validates every scanned code first.
// Posted as multipart/form-data so the DELIVERY CHALLAN can travel with the
// dispatch. Multer ignores a plain JSON body, so a caller that already supplied
// the challan at creation may still post JSON.
router.post("/:id/transfer-dispatch", authorize("transfer:create"), uploadChallan.single("challanDocument"), wh.dispatch);
router.get("/:id/transfer-manifest", authorize("transfer:read"), wh.manifest);
// Receiving at the destination, box label by box label. Partial is fine.
router.get("/:id/transfer-receive-checklist", authorize("transfer:read"), wh.receiveChecklist);
router.post("/:id/transfer-receive-scan", authorize("transfer:create"), wh.receiveScan);
router.post("/:id/transfer-receive", authorize("transfer:create"), wh.receive);

module.exports = router;