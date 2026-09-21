import React from 'react';
import FaqView from '../../Components/FaqView';
import { COMPANY_FAQ, WAREHOUSE_MANAGER_FAQ } from '../../lib/faqData';
import { usePermission } from '../../context/PermissionContext';
import { isWarehouseRole } from '../../lib/roles';

// Company portal FAQ — reachable from the sidebar. Content lives in lib/faqData.js.
// The Company Warehouse Manager (and other warehouse-scoped roles, see
// isWarehouseRole/WAREHOUSE_ROLES in lib/roles.js) gets its OWN FAQ set —
// WAREHOUSE_MANAGER_FAQ — covering only what that role can actually do
// (warehouse dashboard, inventory, receiving lots, stock transfers, labels,
// expiry, warehouse settings/password, profile, support). Company Admin (and
// every other role) keeps the existing COMPANY_FAQ, unchanged. This is the
// ONLY thing that changes by role — the rest of the page (search, layout,
// media sidebar) is shared.
// To add videos: paste an embed URL (YouTube/Vimeo) or a direct .mp4 URL into
// `media.featured.embedUrl`, and set `demosHref` to your demo-videos page.
const CompanyFaq = () => {
  const { role } = usePermission();
  const isWarehouseManager = isWarehouseRole(role);
  const sections = isWarehouseManager ? WAREHOUSE_MANAGER_FAQ : COMPANY_FAQ;
  const subtitle = isWarehouseManager
    ? 'Warehouse operations se related aam sawaalon ke jawab — inventory, receiving, transfers, labels, expiry aur zyada.'
    : 'Company portal se related aam sawaalon ke jawab — registration, inventory, orders, sellers, billing aur zyada.';

  return (
  <FaqView
    title="Frequently Asked Questions"
    subtitle={subtitle}
    sections={sections}
    media={{
      featured: {
        title: 'Getting Started',
        description: 'Dekhiye kaise Khettify portal par company account banaye aur basic setup karein.',
        embedUrl: '/company-getting-started.mp4', // public/ folder se serve hoti hai
      },
      demosHref: '', // ← "View all demo videos" ka link yahan daalein
      help: {
        email: 'company.support@khettify.com',
        callHours: 'Mon–Sat, 10 AM–6 PM',
      },
      proTip: 'FAQ ko search ya category se filter karke aap jaldi sahi jawab tak pahunch sakte hain.',
    }}
  />
  );
};

export default CompanyFaq;
