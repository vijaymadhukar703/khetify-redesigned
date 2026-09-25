const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
// PAPERWORK gate — not an approval or subscription gate. See the note on
// router.use() below for why the two are not the same thing.
const requireSellerProductDocs = require("../../middlewares/requireSellerProductDocs");
// The SAME multer config the company product routes use — imported, never
// edited. It puts files in named buckets: req.files.productImages (max 5) and
// req.files.variantImages (max 10), both written to uploads/products/.
const upload = require("../../middlewares/upload");
const { applyUploadedImages } = require("../../controller/Seller/sellerMyProductController");
const {
  createMyProductBody,
  updateMyProductBody,
  addMyProductStockBody,
} = require("../../validators/sellerMyProductValidators");
const {
  listMyProducts,
  createMyProduct,
  getMyProduct,
  updateMyProduct,
  duplicateCheck,
  getMyProductStock,
  addMyProductStock,
} = require("../../controller/Seller/sellerMyProductController");

/**
 * MY PRODUCTS — the seller's own catalog + their own opening stock.
 *
 * DELIBERATELY UNGATED. No requireApprovedSeller, no loadSubscription, no
 * requireFeature: this module must work for a seller who has just signed up,
 * whether or not any company has approved them and whether or not they pay.
 * A seller uploading their OWN products is the whole point of the feature —
 * gating it behind a company relationship would defeat it.
 *
 * Scoping is not weakened by that: every controller query filters on BOTH
 * `ownerType: "seller"` and `sellerId: req.user.sellerId`, and
 * middlewares/principalRouteGuard.js already refuses a non-seller token on
 * /api/seller/*.
 *
 * CAPABILITIES ARE PER-ROUTE, split read from write: every GET takes
 * "myproduct:read" and every write (POST/PUT) takes "myproduct:manage". Both
 * resolve through config/permissions.js, where seller_admin holds "*" and so
 * keeps the whole module. "myproduct:read" is additionally granted to
 * seller_manager and seller_staff, so a warehouse user can SEE the products
 * their warehouse physically holds without being able to change any of them —
 * creating, editing, adding stock and publishing all stay on
 * "myproduct:manage". A single blanket capability could not express that.
 *
 * ONE gate does apply, and it is not any of those three:
 * requireSellerProductDocs asks only whether the seller has a GST certificate,
 * a PAN and an Agriculture certificate ON FILE. It is orthogonal to company
 * approval and to any plan — an unapproved, unpaid seller with those three
 * documents gets the full module. It sits AFTER auth (it needs
 * req.user.sellerId) and BEFORE every handler, so blocking is enforced by the
 * API itself; the frontend's lock card is a courtesy on top, not the control.
 * The sidebar entry and the page route are untouched: My Products is always
 * reachable, it is the CONTENT that waits on the paperwork.
 */
router.use(auth, requireSellerProductDocs);

// ROUTE ORDER MATTERS: these two literal paths must be declared BEFORE "/:id",
// or Express matches "stock" / "duplicate-check" as an :id and the handlers
// below are never reached.
router.get("/stock", authorize("myproduct:read"), getMyProductStock);
// POST /stock ADDS stock — a write, despite sharing the path with the GET above.
router.post("/stock", authorize("myproduct:manage"), validate({ body: addMyProductStockBody }), addMyProductStock);
router.get("/duplicate-check", authorize("myproduct:read"), duplicateCheck);

router.get("/", authorize("myproduct:read"), listMyProducts);

/* WRITE ROUTES ARE MULTIPART, in the company routes' order:
   auth → authorize → upload → (normalise) → validate → handler.

   `applyUploadedImages` sits between multer and validate on purpose. A
   multipart body is all strings and file buckets, while the zod schema
   describes the DOMAIN shape — and zod strips keys it does not know, so a
   transport artefact left in the body (`variants` as a JSON string,
   `imageIndex`, `kept_images`) would be thrown away before the handler could
   ever act on it. Turning transport into domain shape first is what lets the
   schema stay strict AND the images survive. */
router.post(
  "/",
  authorize("myproduct:manage"),
  upload.uploadProductFields,
  applyUploadedImages,
  validate({ body: createMyProductBody }),
  createMyProduct
);

router.get("/:id", authorize("myproduct:read"), getMyProduct);
router.put(
  "/:id",
  authorize("myproduct:manage"),
  upload.uploadProductFields,
  applyUploadedImages,
  validate({ body: updateMyProductBody }),
  updateMyProduct
);

module.exports = router;
