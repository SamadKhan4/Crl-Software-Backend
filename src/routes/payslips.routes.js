import { Router } from "express";
import { allow } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { ROLES } from "../constants/workflow.js";
import * as c from "../controllers/payslips.controller.js";
import * as v from "../validators/schemas.js";

const router = Router();
const hrAccess = allow(ROLES.ADMIN, ROLES.HR);
router.post("/payslips", hrAccess, validate(v.payslipSchema), c.create);
router.get("/payslips", hrAccess, validate(v.payslipListSchema, "query"), c.list);
router.get("/payslips/:id", hrAccess, validate(v.ids, "params"), c.get);
router.patch("/payslips/:id/status", hrAccess, validate(v.ids, "params"), validate(v.payslipStatusSchema), c.status);

export default router;
