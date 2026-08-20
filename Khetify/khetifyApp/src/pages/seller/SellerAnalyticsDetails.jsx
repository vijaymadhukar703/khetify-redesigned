import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSellerLotDetails, getSellerLotAvailableUnits } from '../../lib/sellerApi';
import AnalyticsDetailsView, { AnalyticsDetailsShell } from '../../Components/ims/AnalyticsDetailsView';
import { warehouseLocationOf } from '../../lib/warehouseLocation';
import useAvailableUnits from '../../Components/ims/useAvailableUnits';

/**
 * SELLER → ANALYTICS → VIEW — READ-ONLY details for ONE Analytics row.
 *
 * Serves BOTH Seller Analytics (seller_admin, every warehouse) and Seller
 * Warehouse Analytics (a scoped seller_manager): the same page, the same
 * endpoints, with the warehouse scope applied SERVER-side from the token — so a
 * manager physically cannot open a lot outside their warehouse, and there is no
 * second page to keep in step.
 *
 * Reuses GET /api/seller/lots/:lotId/details, the endpoint Seller Lot Details
 * already runs on, and renders through the shared AnalyticsDetailsView so this
 * page and the Company Warehouse one are the same experience.
 *
 * Sellers are valued at MRP throughout (they never see cost), which is exactly
 * how the seller Stock on Hand report computes its own `value` column — so
 * Total Amount and Total Stock Value here restate the number the row showed.
 *
 * THIS PAGE WRITES NOTHING.
 */
const SellerAnalyticsDetails = () => {
  const { lotId } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loadedFor, setLoadedFor] = useState(null);
  const loading = loadedFor !== lotId;

  // Same control as every other Analytics View page, pointed at the seller's own
  // owner-scoped endpoint.
  const units = useAvailableUnits(lotId, getSellerLotAvailableUnits);

  useEffect(() => {
    let cancelled = false;
    getSellerLotDetails(lotId)
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

  const back = { backTo: '/seller/analytics', backLabel: 'Back to Analytics' };
  if (loading) return <AnalyticsDetailsShell {...back}><p className="mt-6 text-sm text-stone-400">Loading…</p></AnalyticsDetailsShell>;
  if (err) return <AnalyticsDetailsShell {...back}><p className="mt-6 text-sm text-stone-500">{err}</p></AnalyticsDetailsShell>;
  if (!d?.lot) return <AnalyticsDetailsShell {...back}><p className="mt-6 text-sm text-stone-500">This analytics record could not be loaded.</p></AnalyticsDetailsShell>;

  // The seller payload is already a shaped view-model, not a raw lot document.
  const lot = d.lot;
  const availableQty = Number(d.stock?.currentQuantity || 0);
  const mrp = Number(lot.mrp || 0);
  const warehouseName = lot.sellerWarehouse || 'Unassigned';

  const vm = {
    ...back,
    title: lot.productName || 'Product',
    subtitle: lot.lotNumber,
    product: {
      name: lot.productName,
      code: lot.productCode,
      category: lot.category,
      lotNumber: lot.lotNumber,
      batchNumber: lot.batchNumber,
      warehouse: warehouseName,
      quantity: availableQty,
      mrp: lot.mrp,
      totalAmount: availableQty * mrp,
      mfgDate: lot.mfgDate,
      expiryDate: lot.expiryDate,
    },
    inventory: {
      warehouse: warehouseName,
      availableQty,
      receivingStatus: lot.receivingStatus,
      lowStockThreshold: lot.lowStockThreshold,
    },
    stock: {
      availableQty,
      stockValue: availableQty * mrp,
      warehouseLocation: warehouseLocationOf(warehouseName, lot.sellerWarehouseCode, lot.sellerWarehouseAddress),
    },
  };

  return <AnalyticsDetailsView vm={vm} units={units} />;
};

export default SellerAnalyticsDetails;
