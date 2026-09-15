import { Router } from "express";
import * as c from "../controllers/branches.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { ROLES } from "../constants/workflow.js";
import { allow } from "../middlewares/auth.js";
import { addResourceMutations } from "./resource-mutations.js";

const router = Router();
router.post("/branches", allow(ROLES.ADMIN), validate(v.branchSchema), c.createBranch);
router.get("/branches", validate(v.listSchema, "query"), c.listBranches);
router.get("/branches/options", c.branchOptions);
router.get("/branches/:id", validate(v.ids, "params"), c.getBranch);
router.put("/branches/:id", allow(ROLES.ADMIN), validate(v.ids, "params"), validate(v.branchSchema), c.updateBranch);
router.patch(
  "/branches/:id/status",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.updateBranchStatus,
);

addResourceMutations(router, "branches", v.branchUpdateSchema, c.updateBranch);

export default router;
