import { Router } from "express";
import * as c from "../controllers/shipments.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { ROLES } from "../constants/workflow.js";
import { allow, permit } from "../middlewares/auth.js";
import { uploadLR } from "../middlewares/upload.js";
import { addResourceMutations } from "./resource-mutations.js";

const router = Router();
const adminManager = allow(ROLES.ADMIN, ROLES.MANAGER);
router.post("/shipments", permit("LR", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.shipmentSchema), c.createShipment);
router.get("/shipments", permit("LR", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.shipmentListSchema, "query"), c.listShipments);
router.get("/shipments/:id", permit("LR", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.shipmentDetails);
router.put("/shipments/:id", adminManager, validate(v.ids, "params"), validate(v.shipmentUpdateSchema), c.updateShipment);
router.get("/shipments/:id/history", validate(v.ids, "params"), c.shipmentHistory);
router.get("/shipments/:id/documents/:documentId/download", validate(v.documentIds, "params"), c.downloadDocument);
router.post("/shipments/:id/status", adminManager, validate(v.ids, "params"), validate(v.statusSchema), c.updateStatus);
router.post("/shipments/:id/receive", adminManager, validate(v.ids, "params"), validate(v.receiveSchema), c.receiveShipment);
router.post("/shipments/:id/lr-image", adminManager, validate(v.ids, "params"), uploadLR, c.uploadLRImage);
router.post(
  "/shipments/:id/lr-image/verify",
  allow(ROLES.ADMIN, ROLES.MANAGER),
  validate(v.ids, "params"),
  validate(v.verifySchema),
  c.verifyLRImage,
);
router.post("/shipments/:id/lr-upload-token", adminManager, validate(v.ids, "params"), c.createUploadToken);
router.post("/shipments/:id/complete", adminManager, validate(v.ids, "params"), c.completeShipment);
router.post("/shipments/:id/close", allow(ROLES.ADMIN, ROLES.MANAGER), validate(v.ids, "params"), c.closeShipment);
router.post(
  "/shipments/:id/admin-override",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.overrideSchema),
  c.adminOverride,
);

addResourceMutations(router, "shipments", v.shipmentPatchSchema, c.updateShipment);

export default router;
