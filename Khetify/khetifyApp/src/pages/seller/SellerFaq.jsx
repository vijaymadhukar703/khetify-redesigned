import React from 'react';
import FaqView from '../../Components/FaqView';
import { SELLER_FAQ } from '../../lib/faqData';

// Seller portal FAQ — reachable from the sidebar. Content lives in lib/faqData.js.
// To add videos: paste an embed URL (YouTube/Vimeo) or a direct .mp4 URL into
// `media.featured.embedUrl`, and set `demosHref` to your demo-videos page.
const SellerFaq = () => (
  <FaqView
    title="Frequently Asked Questions"
    subtitle="Seller portal se related aam sawaalon ke jawab — PC applications, catalog, inventory, outbound, supply aur zyada."
    sections={SELLER_FAQ}
    media={{
      featured: {
        title: 'Getting Started',
        description: 'Dekhiye kaise Khettify par seller account banaye aur PC ke liye apply karein.',
        embedUrl: '', // ← apni video ka URL yahan paste karein
      },
      demosHref: '', // ← "View all demo videos" ka link yahan daalein
      help: {
        email: 'support@khetify.com',
        callHours: 'Mon–Sat, 10 AM–6 PM',
      },
      proTip: 'FAQ ko search ya category se filter karke aap jaldi sahi jawab tak pahunch sakte hain.',
    }}
  />
);

export default SellerFaq;
