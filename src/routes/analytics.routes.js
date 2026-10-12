import { Router } from "express";
import * as c from "../controllers/analytics.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { ROLES } from "../constants/workflow.js";
import { allow } from "../middlewares/auth.js";

import * as mis from "../controllers/mis.controller.js";
import { misParams, misQuery } from "../validators/mis.schemas.js";
const router = Router();
const adminManager = allow(ROLES.ADMIN, ROLES.MANAGER);
router.get("/dashboard/summary", c.dashboard);
router.get("/activity", adminManager, validate(v.activitySchema, "query"), c.activity);
router.get("/reports/shipments", adminManager, validate(v.reportSchema, "query"), c.shipmentReport);
router.get("/reports/shipments/export", adminManager, validate(v.reportSchema, "query"), c.exportShipments);
router.get("/reports/mis/:report", adminManager, validate(misParams, "params"), validate(misQuery, "query", { preserveBranchFilters: true }), mis.list);
router.get("/reports/mis/:report/export", adminManager, validate(misParams, "params"), validate(misQuery, "query", { preserveBranchFilters: true }), mis.exportCsv);
router.get("/reports/invoice-payments/:id", adminManager, validate(v.ids, "params"), mis.invoicePayments);
router.get("/reports/authorizations/:id", adminManager, validate(v.ids, "params"), mis.loaDetail);
router.get("/reports/authorizations/:id/document", adminManager, validate(v.ids, "params"), mis.loaDocument);


export default router;
