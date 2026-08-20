const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const generateWaveBody = z.object({
  warehouseId: objectId.optional(),
  orderIds: z.array(objectId).min(1),
});

const pickLineBody = z.object({
  lineIndex: z.coerce.number().int().nonnegative(),
  binCode: z.string().trim().optional(),
  serials: z.array(z.string().trim()).optional(),
  qty: z.coerce.number().int().positive().optional(),
});

const createPackageBody = z.object({
  orderId: objectId,
  items: z.array(z.object({
    productId: objectId,
    qty: z.coerce.number().int().positive(),
    serials: z.array(z.string().trim()).optional(),
  })).min(1),
  weightKg: z.coerce.number().nonnegative().optional(),
  dims: z.string().trim().optional(),
});

const dispatchBody = z.object({
  orderId: objectId,
  vehicleNo: z.string().trim().optional(),
  driverName: z.string().trim().optional(),
  driverPhone: z.string().trim().optional(),
  transporter: z.string().trim().optional(),
  toLabel: z.string().trim().optional(),
  fromWarehouseId: objectId.optional(),
});

// Pick modal scan. `code` may be a Bulk Packaging ID, a unit code or a lot
// number — which one it IS comes from the database lookup, not from this shape.
// `selectedCodes` is the client's current selection, echoed back so the server
// can skip duplicates and measure what is still required.
const pickScanBody = z.object({
  code: z.string().trim().min(1),
  orderType: z.enum(["order", "supply"]),
  orderId: objectId,
  selectedCodes: z.array(z.string().trim()).max(20000).optional(),
});

module.exports = { generateWaveBody, pickLineBody, createPackageBody, dispatchBody, pickScanBody };
