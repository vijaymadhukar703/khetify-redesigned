/**
 * One readable line for a warehouse: "Bhopal Warehouse · (BHO) · MP Nagar,
 * Bhopal, MP, 462011".
 *
 * `address` on the Warehouse model is a SUBDOCUMENT (line1/city/district/state/
 * pincode), not a string — rendering it straight into JSX prints [object
 * Object]. Only the parts that are actually filled in are joined, so a warehouse
 * with no address still reads as its name.
 *
 * Used by the Analytics View pages, which show it as "Warehouse Location".
 */
export const warehouseLocationOf = (name, code, address) => {
  const a = address || {};
  return [
    name,
    code && `(${code})`,
    [a.line1, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ');
};

export default warehouseLocationOf;
