const { z } = require("zod");

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const sellFefoBody = z.object({
  productId: objectId,
  qty: z.coerce.number().int().positive(),
  channel: z.enum(["online", "offline"]).optional(),
  refId: objectId.optional(),
});

const receiveBody = z.object({
  productId: objectId,
  warehouseId: objectId.nullable().optional(),
  // Lot number is the single identity. Optional here because auto-numbering
  // modes generate it server-side; the service requires one (manual or auto).
  lotNumber: z.string().trim().min(1).optional(),
  // SEGMENTED MANUAL ENTRY: the operator supplies only the LEADING parts of the
  // number and the service appends the serial from the same counter the Khetify
  // number uses. Ignored when a complete lotNumber is also sent. Zod strips
  // unknown keys, so this MUST be listed or the field is dropped here.
  lotNumberPrefix: z.string().trim().min(1).max(120).optional(),
  // COMPOSED MANUAL ENTRY: the ordered parts the operator ticked in the Create
  // Lot modal. Takes precedence over lotNumberPrefix, because the range parts
  // (Bulk Packaging / SKU) can only be rendered once the box and unit counts are
  // known — so the number is assembled server-side from these, and the same
  // recipe then mints every box and unit ID. See lotNumberSegmentService.
  lotSegments: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        type: z.enum(["value", "range"]).optional(),
        value: z.string().trim().max(60).optional(),
        prefix: z.string().trim().max(40).optional(),
        digits: z.coerce.number().int().min(1).max(12).optional(),
        // Range parts only: "variable" counts (a span, one member per box/unit),
        // "fixed" is one constant value shared by all of them.
        mode: z.enum(["variable", "fixed"]).optional(),
      })
    )
    .max(20)
    .optional(),
  // Accepted for backwards compatibility only — the service ignores any client
  // batchNumber and mirrors it from lotNumber (they can never diverge).
  batchNumber: z.string().trim().min(1).optional(),
  // Manufacturer/supplier batch number — a SEPARATE, optional, display-only
  // value stored in Inventory.mfgBatchNo (never part of the lot identity/index).
  // Optional, so callers that don't send it (other roles) are unaffected. Zod
  // strips unknown keys, so this MUST be listed or the field is dropped here.
  mfgBatchNo: z.string().trim().max(120).optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  mfgDate: z.coerce.date().nullable().optional(),
  qty: z.coerce.number().int().positive(),
  lowStockThreshold: z.coerce.number().int().nonnegative().optional(),
  note: z.string().trim().max(500).optional(),
  // BULK PACKAGING — the lot is packed into multiple physical outer boxes.
  // Shape only here; the boxes × units-per-box === qty rule lives in
  // bulkPackageService.validateBulkPackaging so ONE definition governs every
  // caller (and so a browser-side quantity edit can't bypass it).
  // NOT z.coerce.boolean() — that turns the STRING "false" into true.
  hasBulkPackaging: z
    .preprocess((v) => (typeof v === "string" ? v === "true" || v === "1" : v), z.boolean())
    .optional(),
  numberOfBoxes: z.coerce.number().int().positive().optional(),
  unitsPerBox: z.coerce.number().int().positive().optional(),
  // THREE-LEVEL PACKAGING — how the `numberOfBoxes` inner boxes are grouped into
  // main boxes. Optional; omitted for the historical two-level lot. The service
  // only accepts them when mainBoxes × boxesPerMain === numberOfBoxes.
  mainBoxes: z.coerce.number().int().positive().optional(),
  boxesPerMain: z.coerce.number().int().positive().optional(),
});

const receiveBoxBody = z.object({
  bulkPackagingId: z.string().trim().min(1),
});

const transferBody = z.object({
  inventoryId: objectId,
  toWarehouseId: objectId,
  qty: z.coerce.number().int().positive(),
});

module.exports = { sellFefoBody, receiveBody, transferBody, receiveBoxBody };