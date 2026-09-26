import { Router } from "express";
import { ROLES } from "../constants/workflow.js";
import * as controller from "../controllers/pickup-request.controller.js";
import { permit } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { ids } from "../validators/schemas.js";
import {
  agentLrListSchema,
  pickupAgentAssignmentSchema,
  pickupRequestListSchema,
  pickupRequestSchema,
  pickupRequestStatusSchema,
} from "../validators/expansion.schemas.js";

const router = Router();
const roles = [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];

router.get(
  "/agent-lrs",
  permit("PICKUP", "VIEW", ...roles),
  validate(agentLrListSchema, "query"),
  controller.agentLrs,
);

router.post(
  "/pickup-requests",
  permit("PICKUP", "ADD", ...roles),
  validate(pickupRequestSchema),
  controller.create,
);
router.get(
  "/pickup-requests",
  permit("PICKUP", "VIEW", ...roles),
  validate(pickupRequestListSchema, "query"),
  controller.list,
);
router.get(
  "/pickup-requests/summary",
  permit("PICKUP", "VIEW", ...roles),
  controller.summary,
);
router.get(
  "/pickup-requests/:id",
  permit("PICKUP", "VIEW", ...roles),
  validate(ids, "params"),
  controller.detail,
);
router.patch(
  "/pickup-requests/:id/assign-agent",
  permit("PICKUP", "EDIT", ...roles),
  validate(ids, "params"),
  validate(pickupAgentAssignmentSchema),
  controller.assignAgent,
);
router.patch(
  "/pickup-requests/:id/status",
  permit("PICKUP", "EDIT", ...roles),
  validate(ids, "params"),
  validate(pickupRequestStatusSchema),
  controller.updateStatus,
);

export default router;
