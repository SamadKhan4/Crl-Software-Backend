import { Router } from "express";
import * as c from "../controllers/analytics.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";

const router = Router();
router.get("/dashboard/summary", c.dashboard);
router.get("/activity", validate(v.activitySchema, "query"), c.activity);
router.get("/reports/shipments", validate(v.reportSchema, "query"), c.shipmentReport);
router.get("/reports/shipments/export", validate(v.reportSchema, "query"), c.exportShipments);

export default router;
