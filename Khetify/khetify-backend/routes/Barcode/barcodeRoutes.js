const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { generateBody, printBody, transitionBody, scanBody, recallBody } = require("../../validators/barcodeValidators");
const ctrl = require("../../controller/Barcode/barcodeController");

/* /api/units */
const units = express.Router();
units.get("/", auth, authorize("lot:read"), ctrl.list);
// Unit-label count per lot (read-only roll-up) — registered before /:param-style
// routes so it can never be swallowed by one.
units.get("/counts", auth, authorize("lot:read"), ctrl.counts);
units.get("/history/:serial", auth, authorize("lot:read"), ctrl.history);
units.post("/generate", auth, authorize("lot:receive"), validate({ body: generateBody }), ctrl.generate);
units.post("/print", auth, authorize("lot:read"), validate({ body: printBody }), ctrl.print);
units.post("/transition", auth, authorize("putaway:execute"), validate({ body: transitionBody }), ctrl.transition);

/* /api/scan — single scan entry point for all workflows */
const scan = express.Router();
scan.post("/", auth, authorize("inventory:read"), validate({ body: scanBody }), ctrl.scan);

/* /api/recall — company_admin only (recall:execute) */
const recall = express.Router();
recall.post("/", auth, authorize("recall:execute"), validate({ body: recallBody }), ctrl.recall);

module.exports = { units, scan, recall };
