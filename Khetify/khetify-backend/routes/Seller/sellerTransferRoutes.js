const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
// The delivery challan may be ANY file — an image OR a PDF — so it rides the
// UNRESTRICTED uploader, exactly as the company warehouse transfer does
// (routes/Transport/tmsRoutes.js). The shared document uploader is deliberately
// NOT reused: it caps at 10MB and filters types for the KYC/agreement routes,
// and loosening it would loosen those too.
const uploadChallan = require("../../middlewares/uploadAny");
const { listTransfers, createTransfer, directTransfer, acceptTransfer, rejectTransfer, warehouseStock, accountWarehouses } = require("../../controller/Seller/sellerTransferController");

// Seller inter-warehouse transfer REQUESTS (request → accept → shipment).
// Approved sellers only; reads need transfer:read, write actions need
// transfer:create (seller_admin "*" and seller_manager "transfer:*" hold both;
// seller_staff is read-only). Dispatch + scan-receive live on /seller/shipments.
router.use(auth, requireApprovedSeller);
router.get("/", authorize("transfer:read"), listTransfers);
router.get("/warehouses", authorize("transfer:read"), accountWarehouses); // ALL seller-account warehouses (destination picker)
router.get("/stock", authorize("transfer:read"), warehouseStock); // products held in a warehouse (for the picker)
router.post("/", authorize("transfer:create"), createTransfer);
// DIRECT transfer — no prior request. Same downstream pipeline as an accepted
// request; only the entry point differs.
// Posted as multipart/form-data so the DELIVERY CHALLAN travels with the
// fields, the same shape the company New Transfer form uses. Multer ignores a
// plain JSON body, so any existing caller that posts JSON is unaffected.
router.post("/direct", authorize("transfer:create"), uploadChallan.single("challanDocument"), directTransfer);
router.post("/:id/accept", authorize("transfer:create"), acceptTransfer);
router.post("/:id/reject", authorize("transfer:create"), rejectTransfer);

module.exports = router;