const PDFDocument = require("pdfkit");

/**
 * GST tax invoice for a POS counter sale.
 *
 * Every figure is READ from the saved Order — nothing is recomputed here. The
 * invoice must show exactly what salesService.createOrder charged, so this file
 * only formats and lays out numbers that already exist.
 *
 * Core fonts only (Helvetica), so amounts are printed "Rs. 3,410.00": the ₹
 * glyph is not in the core PDF font set and renders as garbage.
 */

/** Run a pdfkit draw function and resolve the finished PDF as a Buffer.
 *  Same helper shape services/pcPdfService.js uses. */
function render(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try { draw(doc); doc.end(); } catch (e) { reject(e); }
  });
}

const BRAND = "#EA2831";
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

/** Indian digit grouping, 2 decimals, no currency glyph. */
const inr = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `Rs. ${inr(n)}`;

/* ---- amount in words (Indian system: crore / lakh / thousand) ---- */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0-99 -> words. */
function under100(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** 0-999 -> words. */
function under1000(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(under100(rest));
  return parts.join(" ");
}

/**
 * Indian-format words. Paise are rounded to whole rupees (the invoice totals
 * are already rounded to 2dp, so this only ever nudges the words line).
 */
function amountInWords(amount) {
  const n = Math.round(Number(amount) || 0);
  if (n <= 0) return "Zero Rupees Only";

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts = [];
  if (crore) parts.push(`${under1000(crore)} Crore`);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return `${parts.join(" ")} Rupees Only`;
}

/* ---- layout helpers ---- */
const L = 50;              // left margin
const R = 545;             // right edge
const lineAt = (doc, y) => doc.strokeColor("#ddd").moveTo(L, y).lineTo(R, y).stroke();

/* RIGHT-HAND LABEL/VALUE GEOMETRY, shared by the invoice-meta block and the
   totals block. Both halves get an explicit x AND width and the two boxes do
   not touch (440 vs 445), so a label can never be drawn over its value. */
const PAIR_LX = 330;                 // label box: x
const PAIR_LW = 110;                 //            width  (ends at 440)
const PAIR_VX = 445;                 // value box: x
const PAIR_VW = R - PAIR_VX;         //            width  (ends at the right rule)

/* The seller block on the LEFT must stop before the meta block on the right.
   It used to be 300pt wide from x=50, i.e. running to 350 — 20pt INTO the
   label box at 330 — so a long business name wrapped straight across the
   "Invoice No." label. Capping it 10pt short of PAIR_LX keeps the two columns
   apart no matter how long the name is. */
const SELLER_W = PAIR_LX - L - 10;

/**
 * One label/value row at a FIXED y, returning the next row's y.
 *
 * The rows used to be drawn with `continued: true` and no x on the second
 * call, which let PDFKit re-use one cursor and stack the value on top of the
 * label — "INVo2627-0002", "PayCASH", "Rs. 59T0.t0l". Each half now names its
 * own box, and the caller advances y itself.
 *
 * `lineBreak: false` matters: with a fixed row height, a value allowed to wrap
 * would spill into the row below and reproduce the overlap one line down.
 */
function pairRow(doc, label, value, y, { size = 9, labelFont = "Helvetica", valueFont = "Helvetica", labelColor = "#444", step = 13 } = {}) {
  doc.fontSize(size).lineGap(0);
  doc.font(labelFont).fillColor(labelColor).text(label, PAIR_LX, y, { width: PAIR_LW, align: "left", lineBreak: false });
  doc.font(valueFont).fillColor("#111").text(value, PAIR_VX, y, { width: PAIR_VW, align: "right", lineBreak: false });
  return y + step;
}

// Item table geometry: x offset + width per column.
const COLS = [
  { key: "n", x: L, w: 20, align: "left" },
  { key: "desc", x: L + 20, w: 150, align: "left" },
  { key: "hsn", x: L + 170, w: 55, align: "left" },
  { key: "qty", x: L + 225, w: 35, align: "right" },
  { key: "rate", x: L + 260, w: 62, align: "right" },
  { key: "taxable", x: L + 322, w: 68, align: "right" },
  { key: "gst", x: L + 390, w: 42, align: "right" },
  { key: "amount", x: L + 432, w: 63, align: "right" },
];

function row(doc, values, { bold = false, size = 8.5 } = {}) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  const y = doc.y;
  let maxY = y;
  COLS.forEach((c) => {
    doc.text(values[c.key] ?? "", c.x, y, { width: c.w, align: c.align });
    maxY = Math.max(maxY, doc.y);
  });
  doc.y = maxY;
}

/** A blank profile field prints as an empty line, never "undefined"/"null". */
const safe = (v) => (v == null ? "" : String(v).trim());

/**
 * Build the invoice. `order` must be populated (items.productId, customerId);
 * `seller` is the Seller document. Returns a Buffer.
 */
function posInvoicePdf(order, seller) {
  return render((doc) => {
    const items = order.items || [];
    // Summed straight from the frozen per-line taxes — not recomputed.
    const sum = (f) => items.reduce((a, it) => a + Number(it.taxes?.[f] || 0), 0);
    const taxable = sum("taxable");
    const cgst = sum("cgst");
    const sgst = sum("sgst");
    const igst = sum("igst");
    // The Order stores totalAmount (taxable value) and totalTax separately;
    // there is no single grand-total field, so the invoice total is their sum.
    const grand = Number(order.totalAmount || 0) + Number(order.totalTax || 0);

    /* 1. Title */
    doc.fillColor(BRAND).fontSize(20).font("Helvetica-Bold").text("TAX INVOICE", L, 50, { width: R - L, align: "center" });
    doc.moveDown(0.8);
    lineAt(doc, doc.y);
    doc.moveDown(0.8);

    /* 2. Seller (left) and invoice meta (right) */
    const topY = doc.y;
    doc.fillColor("#111").fontSize(12).font("Helvetica-Bold").text(safe(seller?.sellerInfo?.businessName), L, topY, { width: SELLER_W });
    doc.fontSize(9).font("Helvetica").fillColor("#333");
    const gstin = safe(seller?.verification?.gstin);
    if (gstin) doc.text(`GSTIN ${gstin}`, L, doc.y, { width: SELLER_W });
    /* SELLER ADDRESS — exactly two lines, every part used ONCE.
       It used to print the street, then city+state+pincode, while the street
       value in this data is itself the city, giving
           khargone, khargone, mp, 521001
           khargone, mp, 521001
       Parts are now dropped BEFORE joining (so a missing city leaves no stray
       comma and a missing pincode no trailing dash) and repeated values are
       collapsed case-insensitively. Same shape as the on-screen invoice, so
       the two documents finally agree. */
    const addr = seller?.contact?.address || {};
    const sameText = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
    const street = safe(addr.line);
    const city = safe(addr.city);
    const state = safe(addr.state);
    const pincode = safe(addr.pincode);
    const addrLine1 = (sameText(street, city) ? [street] : [street, city]).filter(Boolean).join(", ");
    const addrLine2 = [sameText(state, city) ? "" : state, pincode].filter(Boolean).join(" - ");
    if (addrLine1) doc.text(addrLine1, L, doc.y, { width: SELLER_W });
    if (addrLine2) doc.text(addrLine2, L, doc.y, { width: SELLER_W });

    /* ISSUING WAREHOUSE. Printed ONLY when the warehouse arrived populated —
       on an unpopulated ObjectId `?.name` is undefined, safe() makes that "",
       and the line is skipped rather than printing "Branch: undefined".
       A split sale falls back to the first line that names one. */
    const branch = safe(order.sourceWarehouseId?.name)
      || safe((order.items || []).map((it) => it.sourceWarehouseId?.name).find(Boolean));
    if (branch) doc.text(`Branch: ${branch}`, L, doc.y, { width: SELLER_W });
    const leftEnd = doc.y;

    doc.fontSize(9).font("Helvetica").fillColor("#333");
    const meta = [
      ["Invoice No.", safe(order.invoiceNumber)],
      ["Date", fmtDate(order.createdAt)],
      ["Payment", safe(order.payment?.mode).toUpperCase()],
    ];
    let my = topY;
    meta.forEach(([k, v]) => {
      my = pairRow(doc, `${k}:`, v, my, { labelFont: "Helvetica-Bold" });
    });

    doc.y = Math.max(leftEnd, my) + 10;
    lineAt(doc, doc.y);
    doc.moveDown(0.6);

    /* 3. Bill to */
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#888").text("BILL TO", L, doc.y);
    doc.moveDown(0.2);
    const cust = order.customerId;
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text(safe(cust?.name) || safe(order.customerName) || "Walk-in customer", L, doc.y);
    if (safe(cust?.phone)) doc.fontSize(9).font("Helvetica").fillColor("#333").text(safe(cust.phone), L, doc.y);
    doc.moveDown(0.8);

    /* 4. Item table */
    const headY = doc.y;
    doc.rect(L, headY - 2, R - L, 16).fill("#f5f5f4");
    doc.fillColor("#666");
    doc.y = headY + 2;
    row(doc, { n: "#", desc: "Description", hsn: "HSN", qty: "Qty", rate: "Rate", taxable: "Taxable", gst: "GST %", amount: "Amount" }, { bold: true, size: 7.5 });
    doc.moveDown(0.4);
    lineAt(doc, doc.y);
    doc.moveDown(0.35);

    doc.fillColor("#111");
    items.forEach((it, i) => {
      const t = it.taxes || {};
      const lineTotal = Number(t.taxable || 0) + Number(t.cgst || 0) + Number(t.sgst || 0) + Number(t.igst || 0);
      row(doc, {
        n: String(i + 1),
        desc: safe(it.name) || safe(it.productId?.productName),
        // HSN and GST% come off the frozen line taxes, not the live product.
        hsn: safe(t.hsnCode) || safe(it.productId?.hsnCode),
        qty: String(it.qty ?? ""),
        rate: inr(it.price),
        taxable: inr(t.taxable),
        gst: `${Number(t.gstRate || 0)}%`,
        amount: inr(lineTotal),
      });
      doc.moveDown(0.45);
    });

    lineAt(doc, doc.y);
    doc.moveDown(0.6);

    /* 5. Totals. PRESENTATION ONLY: the split is still computed by
       taxService and still stored per line in items[].taxes — it is simply
       shown here as one combined "GST" figure, intra- or inter-state alike. */
    const totals = [["Taxable value", taxable], ["GST", cgst + sgst + igst]];

    let ty = doc.y;
    totals.forEach(([k, v]) => {
      ty = pairRow(doc, k, money(v), ty, { step: 14 });
    });
    doc.y = ty;
    doc.moveDown(0.3);
    lineAt(doc, doc.y);
    doc.moveDown(0.35);
    // The grand total is the same pair, one size up and bold on both halves.
    doc.y = pairRow(doc, "Total", money(grand), doc.y, {
      size: 11, labelFont: "Helvetica-Bold", valueFont: "Helvetica-Bold", labelColor: "#111", step: 16,
    });
    doc.moveDown(0.9);

    /* 6. Amount in words */
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#888").text("Amount in words", L, doc.y);
    doc.fontSize(9.5).font("Helvetica").fillColor("#111").text(amountInWords(grand), L, doc.y, { width: R - L });
    doc.moveDown(1.2);

    /* 7. Footer */
    lineAt(doc, doc.y);
    doc.moveDown(0.5);
    const status = safe(order.payment?.status);
    if (status && status !== "paid") {
      // A credit sale must visibly say it is not settled.
      doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND).text(`Payment status: ${status.toUpperCase()}`, L, doc.y, { width: R - L });
      doc.moveDown(0.2);
    }
    doc.fontSize(8).font("Helvetica").fillColor("#888").text("This is a computer-generated invoice.", L, doc.y, { width: R - L });
  });
}

module.exports = { posInvoicePdf, amountInWords };
