/**
 * Shared vocabulary for the two shopper-facing order screens (list + detail),
 * so a status can never render one way on one page and another way on the next.
 *
 * The pipeline mirrors the Order model's status enum exactly:
 *   pending → confirmed → packed → shipped → delivered
 * plus two terminal exits that sit OUTSIDE the pipeline: cancelled, returned.
 */

export const FLOW = ["pending", "confirmed", "packed", "shipped", "delivered"];

export const STATUS_LABEL = {
  pending: "Order placed",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

/** What each step actually means to the shopper — used on the detail timeline. */
export const STATUS_BLURB = {
  pending: "We've sent your order to the seller for confirmation.",
  confirmed: "The seller accepted your order and reserved your stock.",
  packed: "Your items are packed and waiting for pickup.",
  shipped: "Your order is on its way.",
  delivered: "Delivered. Thanks for shopping with Khetify!",
  cancelled: "This order was cancelled.",
  returned: "This order was returned.",
};

export const STATUS_ICON = {
  pending: "receipt_long",
  confirmed: "inventory",
  packed: "package_2",
  shipped: "local_shipping",
  delivered: "check_circle",
  cancelled: "cancel",
  returned: "assignment_return",
};

/** Terminal exits render as a flat badge, never as a progress bar. */
export const isDead = (status) => status === "cancelled" || status === "returned";

/** Tailwind classes for the status pill. */
export function statusTone(status) {
  if (status === "cancelled" || status === "returned") return "bg-red-50 text-[#EA2831]";
  if (status === "delivered") return "bg-emerald-100 text-emerald-800";
  if (status === "shipped") return "bg-blue-50 text-blue-700";
  return "bg-amber-50 text-amber-800"; // pending / confirmed / packed
}

/**
 * A shopper may only cancel while the seller hasn't accepted yet. Past that the
 * seller has reserved stock against the order (FEFO allocations are written on
 * confirm), so releasing it is the seller's flow, not ours. The server enforces
 * this too — this is only so the UI doesn't offer a button that would 409.
 */
export const canCancel = (status) => status === "pending";

export const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export const fmtDateTime = (d) =>
  new Date(d).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });