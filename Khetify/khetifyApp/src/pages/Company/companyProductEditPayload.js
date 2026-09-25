import { hydrateCompanyVariants, serializeCompanyVariants } from './companyVariantMeasurements.js';

// Only fields editable on CompanyEditProduct. Ownership, metadata and hidden
// product settings must stay in the database, not round-trip through FormData.
const EDIT_FIELDS = [
  'productName', 'category', 'unit', 'description', 'mrp', 'costPrice',
  'gstPercentage', 'hsnCode', 'availableStock',
  'minimumOrderQuantity', 'countryOrigin', 'shelfLife', 'dispatchLocation',
  'packagingType', 'productStatus', 'storageInstructions', 'safetyInstructions',
];

export function hydrateCompanyEditProduct(product) {
  const state = { product_code: product.product_code, skuNumber: product.skuNumber };
  for (const key of EDIT_FIELDS) {
    const value = product[key];
    if (value != null && typeof value !== 'object') state[key] = value;
  }
  state.variants = hydrateCompanyVariants(product.variants);
  return state;
}

export function companyProductEditPayload(form) {
  const data = new FormData();
  for (const key of EDIT_FIELDS) {
    const value = form[key];
    if (value != null && typeof value !== 'object') data.append(key, String(value));
  }
  // JSON retains each variant's measurements, identity, attributes and images.
  // Omit variantType: legacy records can have variants with type=single.
  if (Array.isArray(form.variants)) {
    data.append('variants', JSON.stringify(serializeCompanyVariants(form.variants)));
  }
  return data;
}
