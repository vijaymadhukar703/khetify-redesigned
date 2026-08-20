const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const upload = require("../../middlewares/upload");
// The challan may be ANY file of any size, so it uses the unrestricted uploader
// rather than the shared document one (which caps at 10MB and filters types for
// the KYC/agreement routes).
const uploadChallan = require("../../middlewares/uploadAny");

/**
 * Multipart turns every field into a string. `scannedCodes` is posted as JSON
 * text alongside the challan file, so it is parsed back into an array before
 * the Zod validator sees it. Anything already an array (a JSON request) is left
 * exactly as it is, and unparseable text is dropped rather than thrown so the
 * validator produces the normal field-level message.
 */
function parseDispatchBody(req, _res, next) {
  const raw = req.body?.scannedCodes;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) req.body.scannedCodes = parsed;
      else delete req.body.scannedCodes;
    } catch { delete req.body.scannedCodes; }
  }
  next();
}
const v = require("../../validators/transportValidators");
const ctrl = require("../../controller/Transport/tmsController");
const trCtrl = require("../../controller/Transport/transferRequestController");

/* /api/vehicles */
const vehicles = express.Router();
vehicles.get("/", auth, authorize("vehicle:read"), ctrl.listVehicles);
vehicles.post("/", auth, authorize("vehicle:manage"), validate({ body: v.createVehicleBody }), ctrl.createVehicle);
vehicles.patch("/:id", auth, authorize("vehicle:manage"), ctrl.updateVehicle);

/* /api/drivers */
const drivers = express.Router();
drivers.get("/", auth, authorize("driver:read"), ctrl.listDrivers);
drivers.post("/", auth, authorize("driver:manage"), validate({ body: v.createDriverBody }), ctrl.createDriver);
drivers.patch("/:id", auth, authorize("driver:manage"), ctrl.updateDriver);

/* /api/shipments (manager) */
const shipments = express.Router();
shipments.get("/", auth, authorize("shipment:read"), ctrl.listShipments);
shipments.get("/discrepancies", auth, authorize("shipment:read"), ctrl.discrepancies);
// Lot-scan lookup for Inventory → Receive Lot. MUST stay above "/:id".
shipments.get("/incoming", auth, authorize("shipment:receive"), ctrl.incomingByLot);
shipments.get("/:id", auth, authorize("shipment:read"), ctrl.getShipment);
// Read-only traceability: parent lots + the exact child serials this transfer moved.
shipments.get("/:id/details", auth, authorize("shipment:read"), ctrl.shipmentDetails);
// Shipment Box labels for this consignment (Company Warehouse → Seller
// transfers that packed loose units into cartons). Read-only.
shipments.get("/:id/boxes", auth, authorize("shipment:read"), ctrl.shipmentBoxes);
// The warehouse New Shipment form posts multipart so the DELIVERY CHALLAN
// travels with the fields. Multer ignores a plain JSON body, so every existing
// caller of this route is unaffected.
shipments.post("/", auth, authorize("shipment:create"), uploadChallan.single("challanDocument"), validate({ body: v.createShipmentBody }), ctrl.createShipment);
shipments.post("/:id/approve", auth, authorize("shipment:dispatch"), ctrl.approve);
// Scan-out for a warehouse→warehouse transfer: what the shipment should
// contain, and one code at a time checked against it. Both read-only.
shipments.get("/:id/dispatch-checklist", auth, authorize("shipment:dispatch"), ctrl.dispatchChecklist);
shipments.post("/:id/dispatch-scan", auth, authorize("shipment:dispatch"), validate({ body: v.dispatchScanBody }), ctrl.dispatchScan);
// DISPATCH now carries the DELIVERY CHALLAN, so it accepts multipart/form-data
// using the SAME unrestricted uploader the create route already uses (an image
// or a PDF, any size). `parseDispatchBody` runs between multer and the
// validator because multipart delivers every field as a STRING — `scannedCodes`
// arrives as JSON text and would fail `dispatchBody`'s array check otherwise.
// A plain JSON caller is untouched: multer passes it through and the parser
// leaves a real array alone.
shipments.post("/:id/dispatch", auth, authorize("shipment:dispatch"), uploadChallan.single("challanDocument"), parseDispatchBody, validate({ body: v.dispatchBody }), ctrl.dispatch);
// RECEIVING BY SCAN — carton by carton, beside the shipping-label path below.
shipments.get("/:id/receive-checklist", auth, authorize("shipment:receive"), ctrl.receiveChecklist);
shipments.post("/:id/receive-scan", auth, authorize("shipment:receive"), validate({ body: v.receiveScanBody }), ctrl.receiveScan);
shipments.post("/:id/receive-units", auth, authorize("shipment:receive"), validate({ body: v.receiveUnitsBody }), ctrl.receiveUnits);
shipments.post("/:id/verify", auth, authorize("shipment:receive"), validate({ body: v.verifyBody }), ctrl.verifyReceipt);
shipments.post("/:id/deliver", auth, authorize("shipment:dispatch"), validate({ body: v.deliverBody }), ctrl.deliver);
shipments.post("/:id/exception", auth, authorize("shipment:receive"), validate({ body: v.exceptionBody }), ctrl.exception);

/* /api/driver (mobile) */
const driver = express.Router();
driver.post("/login", validate({ body: v.driverLoginBody }), ctrl.driverLogin);
driver.get("/shipments", auth, authorize("shipment:read_own"), ctrl.myShipments);
driver.post("/shipments/:id/arrived", auth, authorize("shipment:update_own"), validate({ body: v.arrivedBody }), ctrl.driverArrived);
driver.post("/shipments/:id/pod", auth, authorize("pod:upload"), upload.array("photos", 5), ctrl.driverDeliver);
driver.post("/shipments/:id/exception", auth, authorize("shipment:update_own"), validate({ body: v.exceptionBody }), ctrl.driverException);

/* /api/transfer-requests — inter-warehouse stock requests (B asks A) */
const transferRequests = express.Router();
transferRequests.get("/", auth, authorize("shipment:read"), trCtrl.list);
transferRequests.post("/", auth, authorize("shipment:create"), trCtrl.create);
transferRequests.post("/:id/accept", auth, authorize("shipment:dispatch"), trCtrl.accept);
transferRequests.post("/:id/reject", auth, authorize("shipment:dispatch"), trCtrl.reject);

module.exports = { vehicles, drivers, shipments, driver, transferRequests };