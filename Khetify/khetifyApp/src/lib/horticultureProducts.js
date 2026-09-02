/**
 * HORTICULTURE PRODUCT CATALOGUE
 *
 * The option list behind the optional "Product" dropdown on the seller's
 * upload/edit product form (pages/seller/SellerMyProductForm.jsx).
 *
 * Kept OUT of the form file on purpose: the list is expected to grow, and one
 * file to edit beats hunting for an inline array. Plain strings — the value
 * stored on the product is the label itself.
 *
 * ONE PRODUCT PER ROW. Earlier revisions packed a family into a single option
 * ("Cucurbits - lauki, kaddu, tori, karela, kheera seed"), which meant a seller
 * selling only kaddu could not say so, and searching "kaddu" surfaced a row
 * naming four other crops. Every crop now stands on its own.
 *
 * NAMING: "Hindi (english) type" — "Bhindi (okra) seed". The Hindi name leads
 * because that is what the seller calls it; the English name is there so the
 * search box finds the row either way.
 *
 * ORDER MATTERS: grouped by product family (vegetable seed → planting material
 * → fruit plants → spices → floriculture → medicinal/aromatic → mushroom →
 * other), but the group headings are deliberately NOT part of the data. The
 * dropdown shows a flat product list, nothing else.
 *
 * A CROP APPEARS ONCE. Dhaniya, methi and mirch are each both a vegetable and a
 * spice; each is listed a single time rather than twice, because a duplicate row
 * in a flat list is just an ambiguous choice.
 *
 * OLD VALUES ARE NOT MIGRATED. The product stores this string, not an id, so
 * products saved against a previous revision of this list keep whatever they
 * were saved with. The form shows such a value as-is and lets the seller either
 * keep it or pick from the current list — nothing rewrites it behind their back.
 */
const HORTICULTURE_PRODUCTS = [
  // ── Vegetable seed ──
  'Tamatar (tomato) seed',
  'Mirch (chilli) seed',
  'Shimla mirch (capsicum) seed',
  'Baingan (brinjal) seed',
  'Bhindi (okra) seed',
  'Lauki (bottle gourd) seed',
  'Kaddu (pumpkin) seed',
  'Tori (ridge gourd) seed',
  'Karela (bitter gourd) seed',
  'Kheera (cucumber) seed',
  'Tarbooz (watermelon) seed',
  'Kharbooza (muskmelon) seed',
  'Phool gobhi (cauliflower) seed',
  'Patta gobhi (cabbage) seed',
  'Broccoli seed',
  'Palak (spinach) seed',
  'Methi (fenugreek) seed',
  'Dhaniya (coriander) seed',
  'Muli (radish) seed',
  'Gajar (carrot) seed',
  'Chukandar (beetroot) seed',
  'Shalgam (turnip) seed',
  'Matar (pea) seed',
  'Sem (broad bean) seed',
  'Lobia (cowpea) seed',
  'Gwar phali (cluster bean) seed',
  'Pyaz (onion) seed',
  'Company-packed vegetable hybrid seed packets',

  // ── Planting material (tubers, bulbs, rhizomes) ──
  'Aloo (seed potato) beej',
  'Pyaz (onion) bulbs / sets',
  'Lehsun (garlic) cloves for sowing',
  'Adrak (ginger) rhizome',
  'Haldi (turmeric) rhizome',
  'Arbi (colocasia) seed material',
  'Suran (elephant foot yam) seed material',
  'Shakarkand (sweet potato) seed material',

  // ── Fruit plants ──
  'Aam (mango) grafted plants',
  'Amrud (guava) plants',
  'Chikoo (sapota) plants',
  'Ber (indian jujube) plants',
  'Nimbu (lemon) plants',
  'Santra (orange) plants',
  'Mausambi (sweet lime) plants',
  'Kela (banana) tissue culture plants',
  'Papita (papaya) seed / seedlings',
  'Anar (pomegranate) plants',
  'Anjeer (fig) plants',
  'Aanwla (indian gooseberry) plants',
  'Sitaphal (custard apple) plants',
  'Dragon fruit cuttings',
  'Seb (apple) plants',
  'Nashpati (pear) plants',
  'Aadu (peach) plants',
  'Akhrot (walnut) plants',
  'Nariyal (coconut) plants',
  'Supari (areca nut) plants',
  'Kaju (cashew) plants',

  // ── Spices ──
  'Jeera (cumin) seed',
  'Saunf (fennel) seed',
  'Ajwain (carom) seed',
  'Kalonji (nigella) seed',
  'Elaichi (cardamom) plants',
  'Kali mirch (black pepper) plants',
  'Dalchini (cinnamon) plants',

  // ── Floriculture & ornamentals ──
  'Genda (marigold) seed / seedlings',
  'Gulab (rose) plants / cuttings',
  'Gladiolus corms',
  'Rajnigandha (tuberose) bulbs',
  'Lily bulbs',
  'Gerbera plants',
  'Carnation plants',
  'Chrysanthemum plants',
  'Chameli (jasmine) plants',
  'Mogra (arabian jasmine) plants',
  'Ornamental, indoor and foliage plants',
  'Lawn grass',

  // ── Medicinal & aromatic ──
  'Ashwagandha (winter cherry) seed',
  'Safed musli seed',
  'Satavar (asparagus) seed',
  'Isabgol (psyllium) seed',
  'Tulsi (holy basil) plants',
  'Aloe vera plants',
  'Stevia plants',
  'Lemongrass slips',
  'Citronella slips',
  'Palmarosa slips',
  'Pudina (mint) suckers',
  'Khus (vetiver) roots',

  // ── Mushroom spawn ──
  'Button mushroom spawn',
  'Oyster mushroom spawn',
  'Milky mushroom spawn',

  // ── Other ──
  'Nursery / paudhshala',
];

export default HORTICULTURE_PRODUCTS;
export { HORTICULTURE_PRODUCTS };
