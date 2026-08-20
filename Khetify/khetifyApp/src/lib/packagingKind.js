/**
 * THE PACKAGING LEVELS, named and coloured in ONE place — read by
 * Components/ims/PackagingChip and by anything that needs the words without the
 * chip. Wherever a box is listed it must read the same, which is only
 * guaranteed if a single definition decides it.
 *
 * BULK PACKAGING vs BOX PACKAGING is a real distinction, not a rename:
 *   bulk_package — a carton minted WITH the lot, its ID derived from the lot
 *                  number, holding units of that one lot
 *   repack       — a carton assembled at DISPATCH out of loose picked units,
 *                  which may come from several lots
 * Deliberately different colours as well as different words, so the two are
 * told apart at a glance in a list that mixes them.
 */
export const PACKAGING_KINDS = {
  bulk_package: { label: 'Bulk Packaging', cls: 'bg-amber-50 text-amber-700' },
  // A box INSIDE a bulk packaging carton. Named apart from its parent because
  // receiving scans both, and "Bulk Packaging" on the inner box would hide which
  // of the two the operator actually has in their hand. Same colour family as
  // the parent — it is the same kind of packaging, one level down.
  inner_box: { label: 'Inner Box', cls: 'bg-amber-50/70 text-amber-600 ring-1 ring-amber-200' },
  // The whole transfer in one scan — the manifest barcode, not a physical box.
  shipment: { label: 'Shipping Label', cls: 'bg-emerald-50 text-emerald-700' },
  repack: { label: 'Box Packaging', cls: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' },
  lot: { label: 'Lot', cls: 'bg-blue-50 text-blue-700' },
  unit: { label: 'Unit', cls: 'bg-stone-100 text-stone-600' },
};

export const packagingKind = (kind) => PACKAGING_KINDS[kind] || PACKAGING_KINDS.unit;
export const packagingLabel = (kind) => packagingKind(kind).label;
