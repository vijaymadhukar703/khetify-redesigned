import React from 'react';
import { packagingKind } from '../../lib/packagingKind';

/**
 * THE PACKAGING-LEVEL CHIP — used everywhere a packed unit set is listed
 * (Dispatch scan-out, the repack box view, Inventory, Barcodes & Labels,
 * Traceability, receiving). The words and colours live in lib/packagingKind so
 * a repack carton reads "Box Packaging" identically on every one of them, and
 * can never be confused with a lot's own "Bulk Packaging" box.
 */
const PackagingChip = ({ kind = 'unit', className = '' }) => {
  const k = packagingKind(kind);
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${k.cls} ${className}`}>
      {k.label}
    </span>
  );
};

export default PackagingChip;
