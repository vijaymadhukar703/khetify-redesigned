const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const createVehicleBody = z.object({
  regNo: z.string().trim().min(1),
  type: z.string().trim().optional(),
  capacityKg: z.coerce.number().nonnegative().optional(),
  insuranceExpiry: z.coerce.date().optional(),
  fitnessExpiry: z.coerce.date().optional(),
  status: z.enum(["available", "on_trip", "maintenance", "inactive"]).optional(),
});

const createDriverBody = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(5).max(20),
  pin: z.string().trim().min(4).max(8),
  email: z.string().trim().email().optional(),
  licenseNo: z.string().trim().optional(),
  licenseExpiry: z.coerce.date().optional(),
  vehicleId: objectId.optional(),
});

/**
 * A shipment may now arrive as multipart/form-data (the warehouse New Shipment
 * form posts its delivery challan file alongside the fields), where every value
 * is a string. `lines` is the only structured field, so it is accepted either as
 * a real array (JSON callers — unchanged) or as its JSON text. Anything else is
 * handed to the array schema untouched, so a malformed body still fails
 * validation rather than silently becoming undefined.
 */
const jsonArray = (schema) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch { return v; }
  }, schema);

const createShipmentBody = z.object({
  refType: z.enum(["Order", "SupplyOrder", "Transfer", "Manual"]).optional(),
  refId: objectId.nullable().optional(),
  fromWarehouseId: objectId.nullable().optional(),
  toType: z.enum(["customer", "warehouse", "vendor"]).optional(),
  toWarehouseId: objectId.nullable().optional(),
  customerId: objectId.nullable().optional(),
  toLabel: z.string().trim().min(1),
  // Delivery challan paperwork. The warehouse form requires both; the field is
  // OPTIONAL here because the other creators of this endpoint (Lots → Transfer,
  // accepted stock requests, seller supply) raise shipments without one and must
  // keep working — see routes/Transport/tmsRoutes.js.
  deliveryChallanNumber: z.string().trim().min(1).max(60).optional(),
  // A line names EITHER an exact lot (`inventoryId` — Lots → Transfer, accepted
  // stock requests, supply) OR just a `productId`, which the warehouse New
  // Shipment form sends: the server then splits that quantity across the
  // product's lots at the source warehouse (shipmentService.createShipment).
  lines: jsonArray(z.array(z.object({
    inventoryId: objectId.optional(),
    productId: objectId.optional(),
    packageId: objectId.optional(),
    orderId: objectId.optional(),
    qty: z.coerce.number().int().positive(),
  })).optional()),
  vehicleId: objectId.optional(),
  driverId: objectId.optional(),
  vehicleNo: z.string().trim().optional(),
  driverName: z.string().trim().optional(),
  driverPhone: z.string().trim().optional(),
  transporter: z.string().trim().optional(),
  ewayBillNo: z.string().trim().optional(),
  lrNumber: z.string().trim().optional(),
  freightCost: z.coerce.number().nonnegative().optional(),
});

const geo = { lat: z.coerce.number().optional(), lng: z.coerce.number().optional() };
const dispatchBody = z.object({
  ...geo,
  // WAREHOUSE→WAREHOUSE TRANSFERS: the identifiers the sending warehouse
  // physically scanned on the way out. Optional, so every existing caller is
  // unaffected; when present the server re-resolves each one and requires the
  // set to cover the whole shipment (services/dispatchScanService.js).
  scannedCodes: z.array(z.string().trim().min(1).max(200)).max(5000).optional(),
  /**
   * THE DELIVERY CHALLAN NUMBER, entered in the dispatch dialog.
   *
   * DECLARED HERE BECAUSE ZOD STRIPS WHAT IT DOES NOT KNOW. `validate()` does
   * `req.body = schema.parse(req.body)`, and a z.object() drops every key the
   * schema does not name — silently, with no error. So a challan number that
   * was typed, shown in the field and posted correctly was DELETED between the
   * route and the controller, which then refused the dispatch for a missing
   * number. Naming the field is what lets it through.
   *
   * OPTIONAL HERE ON PURPOSE. This schema only says "if present, it must look
   * like this". WHETHER a challan is required is a rule about the shipment, not
   * about the request body: a transfer that already carries paperwork from the
   * New Transfer form dispatches without resending it, so a `.min(1)` here
   * would wrongly reject that. The requirement itself stays exactly where it
   * was — tmsController.dispatch checks the shipment's FINAL state and still
   * refuses without both the number and the document.
   */
  deliveryChallanNumber: z.string().trim().max(120).optional(),
  // The same value under the name the seller-side dialogs post it as. The
  // controller already reads either, so both are named here rather than letting
  // one of them be stripped and fail in a way that is hard to see.
  challanNumber: z.string().trim().max(120).optional(),
});

/** One code scanned in the dispatch dialog, plus the unit codes already held. */
const dispatchScanBody = z.object({
  code: z.string().trim().min(1).max(200),
  selectedCodes: z.array(z.string().trim().min(1).max(200)).max(20000).optional(),
});
// RECEIVING BY SCAN — one code resolved at a time, then the units landed. The
// shipping-label body (verifyBody) is untouched; this is the carton-by-carton
// path beside it.
const receiveScanBody = z.object({
  code: z.string().trim().min(1).max(200),
  selectedCodes: z.array(z.string().trim().min(1).max(200)).max(20000).optional(),
});
const receiveUnitsBody = z.object({
  serials: z.array(z.string().trim().min(1).max(200)).min(1).max(20000),
  warehouseId: objectId.optional(),
  ...geo,
});
const arrivedBody = z.object({ ...geo });
const verifyBody = z.object({
  qr: z.string().trim().min(1),
  // Transfer receipt POD: the warehouse the verifier is operating at (must be
  // the destination). Receiving needs only the manifest QR + this validation.
  warehouseId: objectId.optional(),
  ...geo,
  lines: z.array(z.object({ lineIndex: z.coerce.number().int().nonnegative(), receivedQty: z.coerce.number().nonnegative() })).optional(),
});
const deliverBody = z.object({
  signedBy: z.string().trim().optional(),
  photoUrls: z.array(z.string().trim()).optional(),
  ...geo,
});
const driverLoginBody = z.object({ phone: z.string().trim().min(5), pin: z.string().trim().min(4) });
const exceptionBody = z.object({ note: z.string().trim().optional(), ...geo });

module.exports = { createVehicleBody, createDriverBody, createShipmentBody, dispatchBody, dispatchScanBody, receiveScanBody, receiveUnitsBody, arrivedBody, verifyBody, deliverBody, driverLoginBody, exceptionBody };