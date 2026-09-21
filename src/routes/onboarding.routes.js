import { Router } from "express";
import { ROLES } from "../constants/workflow.js";
import { allow } from "../middlewares/auth.js";
import { uploadEmployeeDocument } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import * as c from "../controllers/onboarding.controller.js";
import * as v from "../validators/schemas.js";

const router = Router();
const view = allow(ROLES.ADMIN, ROLES.MANAGER, ROLES.HR);
router.post("/employee-onboarding", allow(ROLES.HR), validate(v.employeeOnboardingSchema), c.create);
router.get("/employee-onboarding", view, validate(v.businessListSchema, "query"), c.list);
router.get("/employee-onboarding/:id", view, validate(v.ids, "params"), c.get);
router.post("/employee-onboarding/:id/documents/:documentType", allow(ROLES.HR), validate(v.employeeDocumentParams, "params"), uploadEmployeeDocument, c.upload);
router.get("/employee-onboarding/:id/documents/:documentId/file", view, validate(v.employeeDocumentFileParams, "params"), c.download);
router.post("/employee-onboarding/:id/review", allow(ROLES.MANAGER), validate(v.ids, "params"), validate(v.employeeOnboardingReviewSchema), c.review);

export default router;
