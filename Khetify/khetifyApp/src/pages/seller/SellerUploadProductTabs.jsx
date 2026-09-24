import React, { useState } from 'react';
import SellerMyProductForm from './SellerMyProductForm';
import SellerLibraryProductForm from './SellerLibraryProductForm';

/**
 * MY PRODUCTS → Upload product. Two ways in:
 *   · Inbuilt Library — SellerLibraryProductForm (the form + Company Name)
 *   · Manual Upload   — SellerMyProductForm, unchanged
 *
 * EDIT skips the tabs entirely and opens SellerMyProductForm as before.
 *
 * Both forms stay MOUNTED and the inactive one is hidden, so switching tabs
 * never throws away what was already typed.
 */
const TABS = [
  { key: 'library', label: 'Inbuilt Library', icon: 'library_books' },
  { key: 'manual', label: 'Manual Upload', icon: 'upload_file' },
];

const SellerUploadProductTabs = ({ productId = null, onCancel, onSaved }) => {
  const [active, setActive] = useState('library');

  if (productId) {
    return <SellerMyProductForm productId={productId} onCancel={onCancel} onSaved={onSaved} />;
  }

  return (
    <div>
      {/* Same treatment as the Products / Stock tabs on SellerMyProducts. */}
      <div className="flex gap-1 border-b border-stone-200 overflow-x-auto mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            aria-current={active === t.key ? 'page' : undefined}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              active === t.key
                ? 'border-[#EA2831] text-[#EA2831]'
                : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className={active === 'library' ? '' : 'hidden'}>
        <SellerLibraryProductForm onCancel={onCancel} onSaved={onSaved} />
      </div>
      <div className={active === 'manual' ? '' : 'hidden'}>
        <SellerMyProductForm onCancel={onCancel} onSaved={onSaved} />
      </div>
    </div>
  );
};

export default SellerUploadProductTabs;
