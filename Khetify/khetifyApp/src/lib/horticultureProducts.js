/**
 * HORTICULTURE PRODUCT CATALOGUE
 *
 * The option list behind the optional "Horticulture Product" dropdown on the
 * seller's upload/edit product form (pages/seller/SellerMyProductForm.jsx).
 *
 * Kept OUT of the form file on purpose: the list is expected to grow, and one
 * file to edit beats hunting for an inline array. Plain strings — the value
 * stored on the product is the label itself.
 *
 * ORDER MATTERS: the list is grouped by product family (vegetable seed →
 * planting material → fruit plants → spices → floriculture → medicinal →
 * other), but the group headings are deliberately NOT part of the data. The
 * dropdown shows a flat product list, nothing else.
 */
const HORTICULTURE_PRODUCTS = [
  'Tamatar (tomato) seed',
  'Mirch (chilli) seed',
  'Shimla mirch (capsicum) seed',
  'Baingan (brinjal) seed',
  'Bhindi (okra) seed',
  'Cucurbits - lauki, kaddu, tori, karela, kheera seed',
  'Tarbooz, kharbooza (melon) seed',
  'Phool gobhi, patta gobhi, broccoli seed',
  'Leafy - palak, methi, dhaniya seed',
  'Root veg - muli, gajar, chukandar, shalgam seed',
  'Legumes - matar, sem, lobia, gwar phali seed',
  'Pyaz (onion) seed',
  'Company-packed vegetable hybrid seed packets',
  'Aloo beej (seed potato)',
  'Pyaz sets / onion bulbs',
  'Lehsun ki galli (garlic cloves for sowing)',
  'Adrak rhizome (seed ginger)',
  'Haldi rhizome (seed turmeric)',
  'Arbi, suran, shakarkand seed material',
  'Aam (mango) grafted plants',
  'Amrud, chikoo, ber ke paudhe',
  'Citrus - nimbu, santra, mausambi ke paudhe',
  'Kela (banana) tissue culture plants',
  'Papita (papaya) seed / seedlings',
  'Anar, anjeer, aanwla, sitaphal ke paudhe',
  'Dragon fruit cuttings',
  'Temperate - seb, nashpati, aadu, akhrot ke paudhe',
  'Nariyal, supari, kaju ke paudhe',
  'Dhaniya, jeera, methi, saunf, ajwain seed',
  'Mirch (spice variety) seed',
  'Kalonji seed',
  'Elaichi, kali mirch, dalchini ke paudhe',
  'Genda (marigold) seed / seedlings',
  'Gulab (rose) plants / cuttings',
  'Gladiolus corms, rajnigandha bulbs, lily bulbs',
  'Gerbera, carnation, chrysanthemum plants',
  'Jasmine (chameli, mogra) plants',
  'Ornamental, indoor aur foliage plants',
  'Lawn grass',
  'Ashwagandha, safed musli, satavar, isabgol seed',
  'Tulsi, aloe vera, stevia ke paudhe',
  'Lemongrass, citronella, palmarosa slips',
  'Mentha (pudina) suckers, khus roots',
  'Mushroom spawn (button, oyster, milky)',
  'Nursery / paudhshala',
];

export default HORTICULTURE_PRODUCTS;
export { HORTICULTURE_PRODUCTS };
