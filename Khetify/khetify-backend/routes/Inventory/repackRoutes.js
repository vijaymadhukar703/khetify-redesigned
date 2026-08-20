const express = require("express");
const { z } = require("zod");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const ctrl = require("../../controller/Inventory/repackController");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const packBody = z.object({
  shipmentId: objectId,
  serials: z.array(z.string().trim().min(1).max(200)).min(1).max(20000),
});

const router = express.Router();

// Repacking happens while a transfer is being dispatched, so it rides the
// dispatch capability — the same people who scan the goods out.
router.post("/", auth, authorize("shipment:dispatch"), validate({ body: packBody }), ctrl.pack);
router.get("/", auth, authorize("shipment:read"), ctrl.listForShipment);
// Readable wherever the box ID appears (Dispatch, Inventory, Labels, Trace).
router.get("/:repackBoxId", auth, authorize("inventory:read", "shipment:read", "report:read"), ctrl.contents);
router.post("/:repackBoxId/unpack", auth, authorize("shipment:dispatch"), ctrl.unpack);
// Removing a carton that was never dispatched is part of packing it — same
// capability, and the service refuses once the shipment has left.
router.delete("/:repackBoxId", auth, authorize("shipment:dispatch"), ctrl.discard);

module.exports = router;
