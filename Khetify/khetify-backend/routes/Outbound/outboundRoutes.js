const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { generateWaveBody, pickLineBody, createPackageBody, dispatchBody, pickScanBody } = require("../../validators/outboundValidators");
const ctrl = require("../../controller/Outbound/outboundController");

/* /api/picklists */
const picklists = express.Router();
picklists.get("/", auth, authorize("pick:read"), ctrl.listPickLists);
picklists.get("/:id", auth, authorize("pick:read"), ctrl.getPickList);
// Resolve ONE scan in the Pick modal (bulk package / unit / lot). Read-only,
// but it is a picking tool, so it sits behind the same capability as picking.
picklists.post("/scan", auth, authorize("pick:execute"), validate({ body: pickScanBody }), ctrl.pickScan);
picklists.post("/generate", auth, authorize("pick:execute"), validate({ body: generateWaveBody }), ctrl.generateWave);
picklists.post("/:id/pick", auth, authorize("pick:execute"), validate({ body: pickLineBody }), ctrl.pickLine);
// Direct order pick (no wave) — confirmed orders picked in place from the Pick tab.
picklists.post("/order/:id/pick", auth, authorize("pick:execute"), ctrl.pickOrder);

/* /api/packages */
const packages = express.Router();
packages.get("/", auth, authorize("pack:read"), ctrl.listPackages);
packages.post("/", auth, authorize("pack:execute"), validate({ body: createPackageBody }), ctrl.createPackage);

/* /api/dispatch */
const dispatch = express.Router();
dispatch.post("/", auth, authorize("dispatch:execute"), validate({ body: dispatchBody }), ctrl.dispatch);

module.exports = { picklists, packages, dispatch };
