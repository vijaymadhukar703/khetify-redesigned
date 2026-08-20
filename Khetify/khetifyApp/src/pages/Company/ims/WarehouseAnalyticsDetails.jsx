import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getLotDetails } from '../../../lib/imsApi';
import AnalyticsDetailsView, { AnalyticsDetailsShell } from '../../../Components/ims/AnalyticsDetailsView';
import { warehouseLocationOf } from '../../../lib/warehouseLocation';
import useAvailableUnits from '../../../Components/ims/useAvailableUnits';

/**
 * COMPANY WAREHOUSE → ANALYTICS → VIEW — READ-ONLY details for ONE Analytics row.
 *
 * A Stock on Hand row IS a lot row, so this reuses GET /lots/:id/details, the
 * same endpoint Lot Details runs on. That endpoint answers a warehouse-scoped
 * user with the CURRENT state of THEIR row (the Main Company gets the original
 * register instead), which is exactly the right answer here: warehouse analytics
 * are about what this warehouse holds now. Its own warehouse guard means a
 * scoped user can only ever open a lot in a warehouse they are assigned to.
 *
 * Layout and behaviour come from the shared AnalyticsDetailsView, so this page
 * and the Seller one are the same experience with different data. The Main
 * Company's own Analytics View page (AnalyticsProductDetails) is separate and
 * deliberately untouched.
 *
 * THIS PAGE WRITES NOTHING.
 */
const WarehouseAnalyticsDetails = () => {
  const { lotId } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loadedFor, setLoadedFor] = useState(null);
  const loading = loadedFor !== lotId;

  // The standard Analytics available-units control. ONE fetch, on first open,
  // shared by every button on the page.
  const units = useAvailableUnits(lotId);

  useEffect(() => {
    let cancelled = false;
    getLotDetails(lotId)
      .then((r) => {
        if (cancelled) return;
        setD(r?.data || null); setErr(''); setLoadedFor(lotId);
      })
      .catch((e) => {
        if (cancelled) return;
        setD(null);
        setErr(e?.response?.data?.message || 'Could not load this analytics record.');
        setLoadedFor(lotId);
      });
    return () => { cancelled = true; };
  }, [lotId]);

  const back = { backTo: '/analytics', backLabel: 'Back to Analytics' };
  if (loading) return <AnalyticsDetailsShell {...back}><p className="mt-6 text-sm text-stone-400">Loading…</p></AnalyticsDetailsShell>;
  if (err) return <AnalyticsDetailsShell {...back}><p className="mt-6 text-sm text-stone-500">{err}</p></AnalyticsDetailsShell>;
  if (!d?.lot) return <AnalyticsDetailsShell {...back}><p className="mt-6 text-sm text-stone-500">This analytics record could not be loaded.</p></AnalyticsDetailsShell>;

  const lot = d.lot;
  const p = lot.productId || {};
  const lotNo = lot.lotNumber || lot.batchNumber || '—';
  const availableQty = Number(lot.availableStock || 0);
  const warehouseName = lot.warehouseId?.name || 'Unassigned';
  // Valued exactly as the Stock on Hand row was: qty × (price || MRP).
  const unitPrice = Number(p.price || p.mrp || 0);
  // Total Stock Value follows the Inventory page: available × MRP.
  const stockValue = availableQty * Number(p.mrp || p.price || 0);

  const vm = {
    ...back,
    title: p.productName || 'Product',
    subtitle: lotNo,
    product: {
      name: p.productName,
      code: p.product_code || p.skuNumber,
      category: p.category,
      lotNumber: lotNo,
      batchNumber: lot.mfgBatchNo || lot.batchNumber,
      warehouse: warehouseName,
      quantity: availableQty,
      mrp: p.mrp,
      totalAmount: availableQty * unitPrice,
      mfgDate: lot.mfgDate,
      expiryDate: lot.expiryDate,
    },
    inventory: {
      warehouse: warehouseName,
      availableQty,
      receivingStatus: lot.receiving_status,
      lowStockThreshold: lot.lowStockThreshold,
    },
    stock: {
      availableQty,
      stockValue,
      warehouseLocation: warehouseLocationOf(warehouseName, lot.warehouseId?.code, lot.warehouseId?.address),
    },
  };

  return <AnalyticsDetailsView vm={vm} units={units} />;
};

export default WarehouseAnalyticsDetails;
