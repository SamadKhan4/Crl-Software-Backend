import { Router } from "express";
import { ROLES } from "../constants/workflow.js";
import * as controller from "../controllers/pickup-run-sheet.controller.js";
import { allow, permit } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { ids } from "../validators/schemas.js";
import { pickupRunSheetApprovalSchema, pickupRunSheetListSchema, pickupRunSheetPurSchema, pickupRunSheetSchema } from "../validators/expansion.schemas.js";

const router = Router();
const roles = [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];

router.post("/pickup-run-sheets", permit("PICKUP", "ADD", ...roles), validate(pickupRunSheetSchema), controller.create);
router.get("/pickup-run-sheets", permit("PICKUP", "VIEW", ...roles), validate(pickupRunSheetListSchema, "query"), controller.list);
router.get("/pickup-run-sheets/options", permit("PICKUP", "VIEW", ...roles), controller.options);
router.get("/pickup-run-sheets/:id", permit("PICKUP", "VIEW", ...roles), validate(ids, "params"), controller.detail);
router.post("/pickup-run-sheets/:id/pickups", permit("PICKUP", "EDIT", ...roles), validate(ids, "params"), validate(pickupRunSheetPurSchema), controller.addPickup);
router.patch("/pickup-run-sheets/:id/approval", allow(ROLES.ADMIN, ROLES.MANAGER), validate(ids, "params"), validate(pickupRunSheetApprovalSchema), controller.review);
router.post("/pickup-run-sheets/:id/dispatch", permit("PICKUP", "EDIT", ...roles), validate(ids, "params"), controller.dispatch);

export default router;
