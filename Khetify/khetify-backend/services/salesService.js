const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Customer = require("../model/Sales/Customer");
const Order = require("../model/Order/Order");
const Seller = require("../model/Seller/Seller");
const lotService = require("./lotService");
const tax = require("./taxService");
const { nextSeq } = require("./counterService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Accept an owner object { ownerType, ownerId } OR a bare companyId (legacy →
 * company owner), so existing company callers keep working unchanged. */
function normalizeOwner(owner) {
  if (owner && typeof owner === "object" && owner.ownerType) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId };
  }
  return { ownerType: "company", ownerId: owner };
}

/** Indian fiscal year code for a date, e.g. Jun-2026 → "2627" (FY 2026-27). */
function fiscalYearCode(d = new Date()) {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // FY starts in April
  return `${String(startYear).slice(2)}${String(startYear + 1).slice(2)}`;
}

/** Gapless, monotonic invoice number per OWNER per FY (atomic counter). The
 * counter is keyed by ownerId; sellers get a distinct namespace from companies
 * since their ids differ. */
async function nextInvoiceNumber(ownerId, session) {
  const fy = fiscalYearCode();
  const seq = await nextSeq(ownerId, `inv-${fy}`, session);
  return `INV-${fy}-${String(seq).padStart(4, "0")}`;
}

function defaultAddress(customer) {
  if (!customer?.addresses?.length) return null;
  return customer.addresses.find((a) => a.isDefault) || customer.addresses[0];
}

/**
 * Create a confirmed sale order: resolves customer + per-line GST, RESERVES
 * stock FEFO (lot allocations stored on each line), and assigns a gapless
 * invoice number. Stock is committed later at dispatch.
 */
async function createOrder(owner, { customerId, items = [], salesChannel = "manual", channel = "offline", payment = {}, shippingAddress, billingAddress, orderNumber, performedBy }) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  if (!items.length) throw httpErr("At least one line item is required");

  // The catalog company: for a company owner it's itself; for a seller it's the
  // supplying company whose products the seller resells.
  let catalogCompanyId = ownerType === "company" ? ownerId : null;
  let noCompanyLink = false;
  if (ownerType === "seller") {
    const seller = await Seller.findById(ownerId).select("supplyingCompanyId linkStatus");
    if (seller && seller.linkStatus === "approved" && seller.supplyingCompanyId) {
      catalogCompanyId = seller.supplyingCompanyId;
    } else {
      // Not fatal on its own: a seller may be billing only their OWN products.
      // Re-thrown below if any line actually needs the company catalogue, so the
      // existing 403 still fires for every case it does today.
      noCompanyLink = true;
    }
  }

  // catalogCompanyId is null for a seller with no approved link (own-products-only sale).
  const company = catalogCompanyId
    ? await Company.findById(catalogCompanyId).select("companyInfo")
    : null;
  const companyStateCode = tax.stateCodeFromGstin(company?.companyInfo?.companyDocument?.gstinNumber);

  let customer = null;
  if (customerId) {
    customer = await Customer.findOne({ _id: customerId, ownerType, ownerId });
    if (!customer) throw httpErr("Customer not found", 404);
  }
  const custAddr = defaultAddress(customer);
  const customerStateCode = custAddr?.stateCode || tax.stateCodeFromGstin(customer?.gstin);

  // Resolve products from the catalog company (company's own, or the seller's
  // supplying company) and build priced, taxed lines.
  const productIds = items.map((i) => i.productId);
  // Seller-owned products carry ownerType/sellerId and no companyId, so a second
  // $or clause matches them. For a company owner the $or holds exactly one clause
  // -- { companyId: catalogCompanyId } -- i.e. the query that runs today.
  const products = new Map(
    (await Product.find({
      _id: { $in: productIds },
      $or: [
        ...(catalogCompanyId ? [{ companyId: catalogCompanyId }] : []),
        ...(ownerType === "seller" ? [{ ownerType: "seller", sellerId: ownerId }] : []),
      ],
    })).map((p) => [String(p._id), p])
  );

  // Deferred supplying-company gate: any line that did not resolve from the
  // seller's own products genuinely needed the company catalogue.
  if (noCompanyLink && productIds.some((id) => !products.has(String(id)))) {
    throw httpErr("No approved supplying company", 403);
  }

  const lines = [];
  let totalUnits = 0, totalAmount = 0, totalTax = 0;
  for (const it of items) {
    const product = products.get(String(it.productId));
    if (!product) throw httpErr(`Product ${it.productId} not found`, 404);
    const qty = Number(it.qty);
    if (!qty || qty <= 0) throw httpErr("Each line needs a positive qty");
    const price = it.price != null ? Number(it.price) : (product.mrp || product.price || 0);
    const taxable = qty * price;
    const taxes = tax.computeLineTax({ taxable, gstRate: product.gstPercentage || 0, hsnCode: product.hsnCode, companyStateCode, customerStateCode });
    totalUnits += qty;
    totalAmount += taxable;
    totalTax += taxes.cgst + taxes.sgst + taxes.igst;
    lines.push({ productId: it.productId, name: product.productName, qty, price, taxes, allocations: [] });
  }

  // Reserve stock FEFO per line from the OWNER's stock (company or seller).
  for (const line of lines) {
    line.allocations = await lotService.allocateFEFO({ ownerType, ownerId, productId: line.productId, qty: line.qty, performedBy });
  }

  /**
   * SOURCE WAREHOUSE — recorded from where FEFO ACTUALLY DREW THE STOCK.
   *
   * Without this the order is born unassigned, and a warehouse-scoped user
   * cannot see their own sale: getOrders matches on these two fields and
   * (correctly) hides an order carrying neither.
   *
   * The answer is already in hand — allocateFEFO returns
   * `{ inventoryId, lotNumber, batchNumber, warehouseId, qty, committed, serials }`
   * per reserved lot — so this reads `warehouseId` off the allocations and adds
   * no query. The request body's `warehouseId` is deliberately NOT consulted:
   * the POS sends one to scope its product picker, but only the allocations say
   * where the stock left from, and trusting the body would let a caller
   * mislabel an order.
   *
   * PER LINE: the first allocation's warehouse. A line that splits across
   * warehouses stays fully described by its own untouched `allocations`, and
   * the scope filter matches an order through ANY line, so the first is enough
   * for visibility. A line that reserved NOTHING is left unset — an
   * unfulfillable line must not look assigned.
   *
   * ORDER LEVEL: set ONLY when every line resolved to the SAME warehouse, which
   * is what Order.js defines the field to mean. On a split order it stays null
   * and the per-line field carries the truth; claiming a single warehouse there
   * would misrepresent the order.
   */
  for (const line of lines) {
    const firstAlloc = (line.allocations || [])[0];
    if (firstAlloc?.warehouseId) line.sourceWarehouseId = firstAlloc.warehouseId;
  }
  const lineWarehouses = lines.map((l) => (l.sourceWarehouseId ? String(l.sourceWarehouseId) : null));
  const singleWarehouse = lineWarehouses.every((w) => w && w === lineWarehouses[0]);
  const orderSourceWarehouseId = singleWarehouse ? lines[0].sourceWarehouseId : null;

  const invoiceNumber = await nextInvoiceNumber(ownerId);

  const order = await Order.create({
    ownerType,
    ownerId,
    // Keep companyId populated for company owners (backward-compatible shape /
    // existing companyId-scoped queries); sellers leave it unset.
    companyId: ownerType === "company" ? ownerId : undefined,
    orderNumber: orderNumber || invoiceNumber,
    invoiceNumber,
    customerId: customer?._id || null,
    customerName: customer?.name || undefined,
    billingAddress: billingAddress || custAddr || undefined,
    shippingAddress: shippingAddress || custAddr || undefined,
    items: lines,
    sourceWarehouseId: orderSourceWarehouseId,
    totalUnits,
    totalAmount: tax.round2(totalAmount),
    totalTax: tax.round2(totalTax),
    channel,
    salesChannel,
    payment: { mode: payment.mode, status: payment.status || "pending", txnRef: payment.txnRef },
    status: "confirmed",
  });
  return order;
}

module.exports = { createOrder, nextInvoiceNumber, fiscalYearCode };
