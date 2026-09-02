const mongoose = require("mongoose");
const ShopPayment = require("../model/Shop/ShopPayment");
const Consumer = require("../model/Shop/Consumer");
const orderService = require("./shopOrderService");
const gateway = require("./shopPaymentGateway");

/* ─────────────────────────────────────────────────────────────────────────────
 * 💳 STOREFRONT ONLINE PAYMENT
 *
 * COD is untouched by this file. A COD checkout still goes straight to
 * shopOrderService.checkout() and creates its orders immediately, exactly as
 * before. Nothing here runs for it.
 *
 * THE ONLINE LANE, IN THREE STEPS:
 *
 *   1. initiate()  — price the basket server-side, FREEZE it into a ShopPayment
 *                    row, open a gateway session. NO order exists yet.
 *   2. (shopper pays)
 *   3. complete()  — verify the gateway's verdict, then create the orders from
 *                    the frozen snapshot and stamp them { online, paid }.
 *
 * WHY ORDERS COME LAST:
 *   If orders were created up front they would land in the seller's outbound
 *   queue unpaid, and every seller/warehouse screen would need a new "is it
 *   paid?" check. Creating them only after the money is confirmed means the
 *   Seller, Warehouse and Admin modules keep working with zero changes — every
 *   order they can see is either COD or already paid.
 *
 * TWO WAYS TO FINISH, ONE CODE PATH:
 *   • verifyAndComplete()  — REAL. The browser returns from Razorpay Checkout
 *                            with { gatewayPaymentId, signature }.
 *   • completeMock()       — mock gateway only; refuses outright when a real
 *                            gateway is active.
 *   Both funnel into markPaid(), which is where verification, the server-side
 *   amount re-check and order creation actually live. A future webhook calls
 *   markPaid() too, so browser-return and webhook can never diverge.
 *
 * WHICH GATEWAY IS LIVE is decided in services/shopPaymentGateway.js by whether
 * RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are set. Nothing in this file changes
 * between the two.
 * ───────────────────────────────────────────────────────────────────────────── */

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** A payment session may be retried while it is still open. */
const RETRYABLE = ["created", "processing", "failed"];

/** What the browser is allowed to see. Never leak the raw snapshot back. */
function toPublic(payment) {
  return {
    _id: payment._id,
    method: payment.method,
    provider: payment.provider,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    instrument: payment.instrument || null,
    quote: payment.quote || {},
    gatewayOrderId: payment.gatewayOrderId,
    gatewayPaymentId: payment.gatewayPaymentId || null,
    orderIds: payment.orderIds || [],
    attempts: payment.attempts || 0,
    failureReason: payment.failureReason || null,
    paidAt: payment.paidAt || null,
    expiresAt: payment.expiresAt || null,
    createdAt: payment.createdAt,
  };
}

/** Load a payment that belongs to THIS shopper, or 404. */
async function loadOwned(consumerId, paymentId) {
  if (!mongoose.isValidObjectId(paymentId)) throw httpErr("Payment not found", 404);
  const payment = await ShopPayment.findOne({ _id: paymentId, consumerId });
  if (!payment) throw httpErr("Payment not found", 404);
  return payment;
}

/** Sessions age out; a stale one must not be payable. */
function expireIfStale(payment) {
  if (payment.status === "paid" || payment.status === "cancelled") return false;
  // Never expire a payment mid-finalize: the money is already proven and orders
  // are being written. Expiring it here would strand a real payment.
  if (payment.status === "finalizing") return false;
  if (payment.expiresAt && payment.expiresAt.getTime() < Date.now()) {
    payment.status = "expired";
    payment.failureReason = "This payment session has expired. Please try again.";
    return true;
  }
  return false;
}

/**
 * STEP 1 — open a payment session for the shopper's basket.
 *
 * The basket is priced by shopOrderService.quoteCheckout(), i.e. by the SAME
 * code that will later build the orders, so the amount charged and the amount
 * ordered can never disagree.
 *
 * @param {string} consumerId
 * @param {object} body { items:[{listingId, qty, variantId}], shippingAddressId?, shippingAddress? }
 */
async function initiate(consumerId, body = {}) {
  const consumer = await Consumer.findById(consumerId).select("name email phone");
  if (!consumer) throw httpErr("Account not found", 404);

  // Throws exactly the same stock/address/availability errors COD would, so a
  // bad basket is rejected BEFORE the shopper reaches a payment screen.
  const quote = await orderService.quoteCheckout(consumerId, body);
  if (!(quote.amount > 0)) throw httpErr("This basket has nothing to pay for", 400);

  // Freeze the request. Orders are built from this, never from a later POST.
  const checkoutSnapshot = {
    items: (body.items || []).map((i) => ({
      listingId: i.listingId,
      qty: i.qty,
      variantId: i.variantId || undefined,
    })),
    shippingAddressId: body.shippingAddressId,
    shippingAddress: body.shippingAddressId ? undefined : body.shippingAddress,
  };

  const payment = await ShopPayment.create({
    consumerId,
    method: "online",
    provider: gateway.PROVIDER,
    amount: quote.amount,
    currency: quote.currency,
    status: "created",
    checkoutSnapshot,
    quote,
  });

  /* await: a real gateway makes a network call here (Razorpay POST /v1/orders).
     If it throws, the ShopPayment row above is already written — deliberately.
     It records the attempt that never got a session, rather than vanishing. */
  const session = await gateway.createSession({
    amount: quote.amount,
    currency: quote.currency,
    receipt: String(payment._id),
    customer: { name: consumer.name, email: consumer.email, phone: consumer.phone },
  });

  payment.provider = session.provider;
  payment.gatewayOrderId = session.gatewayOrderId;
  payment.expiresAt = session.expiresAt;
  await payment.save();

  return { payment: toPublic(payment), checkout: session.checkout };
}

/** One of the shopper's own payments. */
async function getPayment(consumerId, paymentId) {
  const payment = await loadOwned(consumerId, paymentId);
  if (expireIfStale(payment)) await payment.save();
  return toPublic(payment);
}

/**
 * The shared success path: verify, then create the orders.
 *
 * Kept as its own function because a REAL gateway has two callers for it — the
 * browser returning from checkout, and the server-to-server webhook — and both
 * must land on identical logic.
 *
 * IDEMPOTENT: called twice, the second call returns the orders the first one
 * created instead of creating a second set.
 */
async function markPaid(payment, { gatewayPaymentId, signature, instrument } = {}) {
  const already = await alreadyPaid(payment);
  if (already) return already;

  // ── SECURITY BOUNDARY. Do not remove when integrating a real gateway. ──
  const ok = gateway.verify({
    gatewayOrderId: payment.gatewayOrderId,
    gatewayPaymentId,
    signature,
  });
  if (!ok) {
    payment.status = "failed";
    payment.failureReason = "We could not verify this payment. No money was deducted.";
    payment.attempts += 1;
    await payment.save();
    throw httpErr("Payment verification failed", 400);
  }

  return finalizePaid(payment, { gatewayPaymentId, signature, instrument });
}

/** The orders a finished payment produced. Used by every idempotent return. */
async function alreadyPaid(payment) {
  if (payment.status !== "paid") return null;
  const orders = await orderService.listOrders(payment.consumerId);
  const mine = new Set((payment.orderIds || []).map(String));
  return { payment: toPublic(payment), orders: orders.filter((o) => mine.has(String(o._id))) };
}

/**
 * The money is proven. Cross-check the amount, then create the orders.
 *
 * SPLIT OUT OF markPaid() because there are now TWO ways to prove the money,
 * and they prove it differently:
 *   • browser return — the Razorpay CHECKOUT signature (markPaid above)
 *   • webhook        — the Razorpay WEBHOOK signature over the raw body
 * Both are equally strong, so both land here. What must NOT differ between them
 * is the amount check and the order creation — hence one shared function.
 *
 * CONCURRENCY. The browser and the webhook routinely race: the shopper's tab
 * finishes verifying at the same moment Razorpay's server calls us. Without a
 * lock, both would pass their checks and BOTH would create orders — the
 * customer pays once and receives two sets of goods.
 *
 * The claim below is a single atomic findOneAndUpdate. Only a status in the
 * open set can move to "finalizing", so exactly one caller wins; the loser sees
 * null and returns the winner's orders instead of creating its own.
 */
async function finalizePaid(payment, { gatewayPaymentId, signature, instrument } = {}) {
  const claimed = await ShopPayment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ["created", "processing", "failed"] } },
    { $set: { status: "finalizing" } },
    { new: true }
  );

  if (!claimed) {
    // Someone else is finalizing, or already has. Re-read and hand back theirs.
    const fresh = await ShopPayment.findById(payment._id);
    const done = fresh && (await alreadyPaid(fresh));
    if (done) return done;
    throw httpErr("This payment is already being processed. Please wait a moment.", 409);
  }
  payment = claimed;

  /* ── SECOND CHECK: ask the GATEWAY, not the browser. ──
     A valid signature proves which payment we are looking at. It does NOT prove
     the money settled, or that it settled for the right amount — a signature is
     issued the moment Checkout closes. So we re-read the payment from the
     provider and insist on "captured" at the exact amount we quoted.

     Without this, a payment that was authorised-then-failed, or one for a
     tampered amount, would still create a shipped order. fetchPayment() returns
     null on the mock (it has no source of truth), which skips the check. */
  const remote = await gateway.fetchPayment(gatewayPaymentId);
  if (remote) {
    if (remote.status !== "captured") {
      payment.status = "failed"; // releases the claim
      payment.failureReason =
        remote.errorDescription || "This payment did not complete. No money was deducted.";
      payment.attempts += 1;
      await payment.save();
      throw httpErr(payment.failureReason, 402);
    }
    // Rupees on both sides (the adapter converts back from paise). A rounding
    // tolerance of one paisa keeps float arithmetic from rejecting a good payment.
    if (Math.abs(remote.amount - payment.amount) > 0.01) {
      payment.status = "failed"; // releases the claim
      payment.failureReason = "The amount paid does not match this order.";
      payment.attempts += 1;
      await payment.save();
      throw httpErr(payment.failureReason, 400);
    }
    if (remote.method && !instrument) instrument = remote.method;
  }

  /* Create the orders from the FROZEN snapshot. If this throws — a product went
     out of stock while the shopper was paying — the payment stays "processing"
     and is NOT marked paid, so it shows up as an unreconciled payment rather
     than silently swallowing money with no order against it. With a real
     gateway this is exactly where an auto-refund would be triggered. */
  let orders;
  try {
    orders = await orderService.checkout(
      payment.consumerId,
      payment.checkoutSnapshot,
      {
        txnRef: gatewayPaymentId,
        provider: payment.provider,
        paidAt: new Date(),
        paymentId: payment._id,
      }
    );
  } catch (err) {
    payment.status = "processing"; // releases the claim for a retry
    payment.failureReason = err.message || "Order creation failed after payment";
    payment.gatewayPaymentId = gatewayPaymentId;
    payment.gatewaySignature = signature;
    await payment.save();
    // Surfaced verbatim so the shopper reads the real reason ("X is out of
    // stock") rather than a generic failure.
    throw httpErr(
      `${err.message || "We could not place your order"}. Your payment has been recorded — please contact support.`,
      err.status || 409
    );
  }

  payment.status = "paid";
  payment.gatewayPaymentId = gatewayPaymentId;
  payment.gatewaySignature = signature;
  if (instrument) payment.instrument = instrument;
  payment.orderIds = orders.map((o) => o._id);
  payment.paidAt = new Date();
  payment.failureReason = undefined;
  await payment.save();

  return { payment: toPublic(payment), orders };
}

/**
 * STEP 3 (REAL) — the shopper has come back from Razorpay Checkout.
 *
 * Everything in the arguments is attacker-controlled: they arrive from the
 * browser. markPaid() is where they stop being trusted — signature first, then
 * a re-read from the provider.
 *
 * @param {object} p { gatewayPaymentId, signature }
 */
async function verifyAndComplete(consumerId, paymentId, { gatewayPaymentId, signature } = {}) {
  const payment = await loadOwned(consumerId, paymentId);

  // Idempotent: a double-submit (or a refresh on the return leg) returns the
  // orders the first call created rather than charging twice.
  if (payment.status === "paid") {
    return markPaid(payment, {
      gatewayPaymentId: payment.gatewayPaymentId,
      signature: payment.gatewaySignature,
    });
  }
  if (expireIfStale(payment)) {
    await payment.save();
    throw httpErr("This payment session has expired. Please checkout again.", 410);
  }
  if (!RETRYABLE.includes(payment.status)) {
    throw httpErr(`This payment is ${payment.status} and can no longer be completed`, 409);
  }
  if (!gatewayPaymentId || !signature) {
    throw httpErr("Incomplete payment confirmation", 400);
  }

  payment.status = "processing";
  await payment.save();

  return markPaid(payment, { gatewayPaymentId, signature });
}

/**
 * The shopper closed or dismissed the gateway's checkout without paying.
 * Not a failure worth an error — just a session left open, and the basket is
 * still intact behind it.
 */
async function markDismissed(consumerId, paymentId) {
  const payment = await loadOwned(consumerId, paymentId);
  if (payment.status === "paid") return toPublic(payment);
  if (RETRYABLE.includes(payment.status)) {
    payment.status = "created"; // reopened, so "Try again" works
    payment.failureReason = "The payment window was closed before the payment completed.";
    await payment.save();
  }
  return toPublic(payment);
}

/**
 * STEP 3 (MOCK) — stands in for the shopper authorising on the gateway screen.
 *
 * ⛔ WHEN A REAL GATEWAY IS INTEGRATED, THIS FUNCTION IS REPLACED by one that
 *    takes { gatewayPaymentId, signature } straight from the gateway's SDK and
 *    calls markPaid() with them. Everything below the mock-authorise call is
 *    already the real thing.
 *
 * @param {"success"|"failure"} outcome  which verdict to simulate
 */
async function completeMock(consumerId, paymentId, { outcome = "success", instrument } = {}) {
  /* Hard refusal, not a fallback. With Razorpay active this endpoint would be a
     way to mint a paid order without paying, so it must be unreachable rather
     than merely unused. */
  if (!gateway.isMock || typeof gateway.authorize !== "function") {
    throw httpErr("This endpoint is only available with the mock payment gateway", 400);
  }

  const payment = await loadOwned(consumerId, paymentId);

  if (payment.status === "paid") {
    return markPaid(payment, {
      gatewayPaymentId: payment.gatewayPaymentId,
      signature: payment.gatewaySignature,
    });
  }
  if (expireIfStale(payment)) {
    await payment.save();
    throw httpErr("This payment session has expired. Please checkout again.", 410);
  }
  if (!RETRYABLE.includes(payment.status)) {
    throw httpErr(`This payment is ${payment.status} and can no longer be completed`, 409);
  }

  payment.status = "processing";
  if (instrument) payment.instrument = instrument;
  await payment.save();

  // ── ⛔ MOCK ONLY: the gateway's verdict, simulated. ──
  const result = gateway.authorize({
    gatewayOrderId: payment.gatewayOrderId,
    amount: payment.amount,
    instrument: payment.instrument,
    outcome,
  });

  if (!result.success) {
    payment.status = "failed";
    payment.failureReason = result.failureReason || "Payment failed";
    payment.attempts += 1;
    await payment.save();
    throw httpErr(payment.failureReason, 402);
  }
  // ── ⛔ END MOCK. Everything from here is real. ──

  payment.attempts += 1;
  return markPaid(payment, {
    gatewayPaymentId: result.gatewayPaymentId,
    signature: result.signature,
    instrument: result.instrument,
  });
}

/** The shopper backed out of the payment screen. No order was ever created. */
async function cancel(consumerId, paymentId) {
  const payment = await loadOwned(consumerId, paymentId);
  if (payment.status === "paid") throw httpErr("This payment is already complete", 409);
  if (payment.status !== "cancelled") {
    payment.status = "cancelled";
    payment.failureReason = "Cancelled by the customer";
    await payment.save();
  }
  return toPublic(payment);
}

/**
 * 🔔 WEBHOOK — Razorpay telling us, server to server, what happened.
 *
 * WHY THIS EXISTS AT ALL:
 *   The browser return leg is not reliable and never was. A shopper who pays
 *   and immediately closes the tab, loses signal, or gets a browser crash never
 *   sends us the confirmation — so the money is at Razorpay and no order exists.
 *   In test mode that is a curiosity. In live mode it is a customer who paid and
 *   got nothing.
 *
 *   The webhook does not care about the browser. Razorpay retries it for hours
 *   until we answer 200, so the order gets created even if the shopper's device
 *   went into the sea.
 *
 * AUTHENTICITY comes from the webhook signature over the RAW request body —
 * verified by the caller (the controller) before this function is reached. That
 * is why no checkout signature is needed here: a different proof, equally
 * strong. The amount cross-check still runs, inside finalizePaid().
 *
 * @param {object} event the parsed Razorpay event body
 */
async function handleWebhookEvent(event = {}) {
  const type = event.event;
  const entity =
    event.payload?.payment?.entity || event.payload?.order?.entity || null;
  if (!entity) return { handled: false, reason: "no entity in payload" };

  // Razorpay's order id is our link back to the ShopPayment we created.
  const gatewayOrderId = entity.order_id || entity.id;
  if (!gatewayOrderId) return { handled: false, reason: "no order id" };

  const payment = await ShopPayment.findOne({ gatewayOrderId });
  // Not ours (or from another environment sharing the account) — answer 200
  // anyway, or Razorpay will retry a payment we can never satisfy.
  if (!payment) return { handled: false, reason: "unknown order" };

  if (type === "payment.captured" || type === "order.paid") {
    const done = await alreadyPaid(payment);
    if (done) return { handled: true, alreadyPaid: true };

    const gatewayPaymentId = entity.order_id ? entity.id : entity.payment_id;
    if (!gatewayPaymentId) return { handled: false, reason: "no payment id" };

    await finalizePaid(payment, { gatewayPaymentId, instrument: entity.method });
    return { handled: true, created: true };
  }

  if (type === "payment.failed") {
    if (payment.status !== "paid") {
      payment.status = "failed";
      payment.failureReason =
        entity.error_description || "The payment failed. No money was deducted.";
      await payment.save();
    }
    return { handled: true, failed: true };
  }

  // Anything else (refunds, settlements) — acknowledged, not acted on yet.
  return { handled: false, reason: `unhandled event ${type}` };
}

/** What the browser needs to open the gateway: publishable key + mode. */
function publicConfig() {
  return gateway.publicConfig();
}

module.exports = {
  initiate,
  getPayment,
  publicConfig,
  verifyAndComplete, // REAL gateway return leg
  markDismissed, // shopper closed the gateway window
  completeMock, // ⛔ mock gateway only — refuses when Razorpay is active
  markPaid, // browser return leg
  handleWebhookEvent, // 🔔 server-to-server leg — survives a closed browser
  cancel,
};