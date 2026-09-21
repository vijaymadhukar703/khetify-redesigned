import React from 'react';
import FaqView from '../../Components/FaqView';
import { SELLER_FAQ, SELLER_WAREHOUSE_FAQ } from '../../lib/faqData';
import { useSellerPermission } from '../../context/SellerPermissionContext';

// Seller portal FAQ — reachable from the sidebar. Content lives in lib/faqData.js.
// seller_manager (warehouse role) gets SELLER_WAREHOUSE_FAQ covering only what
// they can actually do — Home, Dashboard, Inventory, Inbound Supply, Stock
// Transfers (Receive/Send/Transfers/Requests/Traceability), Barcodes & Labels,
// Sales, Stock Valuation, Administration, Account, Support.
// seller_admin and all other roles keep the existing SELLER_FAQ, unchanged.
// To add videos: paste an embed URL (YouTube/Vimeo) or a direct .mp4 URL into
// `media.featured.embedUrl`, and set `demosHref` to your demo-videos page.
const SellerFaq = () => {
  const { role } = useSellerPermission();
  const isWarehouseManager = role === 'seller_manager';
  const sections = isWarehouseManager ? SELLER_WAREHOUSE_FAQ : SELLER_FAQ;
  const subtitle = isWarehouseManager
    ? 'Warehouse operations se related aam sawaalon ke jawab — inventory, inbound supply, stock transfers, send stock, requests aur zyada.'
    : 'Seller portal se related aam sawaalon ke jawab — PC applications, catalog, inventory, outbound, supply aur zyada.';

  return (
    <FaqView
      title="Frequently Asked Questions"
      subtitle={subtitle}
      sections={sections}
      media={{
        featured: {
          title: 'Getting Started',
          description: 'Dekhiye kaise Khettify par seller account banaye aur setup karein.',
          embedUrl: '', // ← apni video ka URL yahan paste karein
        },
        demosHref: '', // ← "View all demo videos" ka link yahan daalein
        help: {
          email: 'seller.support@khettify.com',
          callHours: 'Mon–Sat, 10 AM–6 PM',
        },
        proTip: 'FAQ ko search ya category se filter karke aap jaldi sahi jawab tak pahunch sakte hain.',
      }}
    />
  );
};

export default SellerFaq;