/**
 * DeliveryBadge
 *
 * Renders a small delivery-availability pill on product cards and the detail
 * page. Three states:
 *
 *   deliveryEligible === null   → no pincode known yet; show nothing
 *   deliveryEligible === true   → "Delivery Available"  (green)
 *   deliveryEligible === false  → "Delivery Unavailable" (red/muted)
 *
 * Keeps all delivery-status styling in one place so it cannot drift between
 * the card, the detail page, and the cart.
 */
export default function DeliveryBadge({ deliveryEligible, className = "" }) {
  if (deliveryEligible === null || deliveryEligible === undefined) return null;

  return deliveryEligible ? (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 ${className}`}
    >
      <span className="material-symbols-outlined text-[13px]">local_shipping</span>
      Delivery Available
    </span>
  ) : (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 ${className}`}
    >
      <span className="material-symbols-outlined text-[13px]">block</span>
      Delivery Unavailable
    </span>
  );
}