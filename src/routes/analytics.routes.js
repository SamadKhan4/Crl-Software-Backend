import { Router } from "express";
import * as c from "../controllers/analytics.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { ROLES } from "../constants/workflow.js";
import { allow } from "../middlewares/auth.js";

const router = Router();
const adminManager = allow(ROLES.ADMIN, ROLES.MANAGER);
router.get("/dashboard/summary", c.dashboard);
router.get("/activity", adminManager, validate(v.activitySchema, "query"), c.activity);
router.get("/reports/shipments", adminManager, validate(v.reportSchema, "query"), c.shipmentReport);
router.get("/reports/shipments/export", adminManager, validate(v.reportSchema, "query"), c.exportShipments);

export default router;
