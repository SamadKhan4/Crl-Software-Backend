import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as c from "../controllers/controllers.js";
import { ROLES } from "../constants/workflow.js";
import { authenticate, allow, internalRoles } from "../middlewares/auth.js";
import { uploadLR } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";

const router = Router();
const limit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message, errorCode: "RATE_LIMIT_EXCEEDED", errors: [] },
  });
const authLimiter = limit(15 * 60 * 1000, 10, "Too many authentication attempts");
const publicLimiter = limit(15 * 60 * 1000, 60, "Too many public tracking requests");
const publicUploadLimiter = limit(15 * 60 * 1000, 8, "Too many upload attempts");
const internalLimiter = limit(15 * 60 * 1000, 500, "Too many API requests");

router.post("/auth/login", authLimiter, validate(v.loginSchema), c.login);
router.post("/auth/refresh", authLimiter, validate(v.refreshSchema), c.refresh);
router.post("/auth/logout", validate(v.refreshSchema), c.logout);
router.get("/auth/me", authenticate, c.me);
router.post("/auth/change-password", authenticate, validate(v.passwordSchema), c.changePassword);

router.get("/public/track/:lrNumber", publicLimiter, validate(v.publicTrackSchema, "params"), c.publicTrack);
router.get(
  "/track",
  publicLimiter,
  (req, _res, next) => {
    req.params.lrNumber = req.query.lrNumber;
    next();
  },
  validate(v.publicTrackSchema, "params"),
  c.publicTrack,
);
router.post("/public/lr-upload/request", publicUploadLimiter, validate(v.publicRequestSchema), c.requestPublicUpload);
router.post(
  "/public/lr-upload/:token",
  publicUploadLimiter,
  validate(v.tokenSchema, "params"),
  uploadLR,
  c.publicUploadLR,
);

router.use(authenticate, internalRoles, internalLimiter);
router.get("/dashboard/summary", c.dashboard);
router.get("/reports/shipments", validate(v.reportSchema, "query"), c.shipmentReport);
router.get("/reports/shipments/export", validate(v.reportSchema, "query"), c.exportShipments);

router.post("/users", allow(ROLES.ADMIN), validate(v.userSchema), c.createUser);
router.get("/users", allow(ROLES.ADMIN), validate(v.listSchema, "query"), c.listUsers);
router.get("/users/:id", allow(ROLES.ADMIN), validate(v.ids, "params"), c.getUser);
router.put("/users/:id", allow(ROLES.ADMIN), validate(v.ids, "params"), validate(v.userUpdateSchema), c.updateUser);
router.patch(
  "/users/:id/status",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.updateUserStatus,
);
router.post(
  "/users/:id/reset-password",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.resetPasswordSchema),
  c.resetUserPassword,
);

router.post("/branches", allow(ROLES.ADMIN), validate(v.branchSchema), c.createBranch);
router.get("/branches", validate(v.listSchema, "query"), c.listBranches);
router.get("/branches/:id", validate(v.ids, "params"), c.getBranch);
router.put("/branches/:id", allow(ROLES.ADMIN), validate(v.ids, "params"), validate(v.branchSchema), c.updateBranch);
router.patch(
  "/branches/:id/status",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.updateBranchStatus,
);

router.post("/customers", validate(v.customerSchema), c.createCustomer);
router.get("/customers", validate(v.listSchema, "query"), c.listCustomers);
router.get("/customers/code/:customerCode", validate(v.customerCodeParams, "params"), c.getCustomerByCode);
router.get("/customers/:id", validate(v.ids, "params"), c.getCustomer);
router.put("/customers/:id", validate(v.ids, "params"), validate(v.customerSchema), c.updateCustomer);
router.patch(
  "/customers/:id/status",
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.updateCustomerStatus,
);

router.post("/shipments", validate(v.shipmentSchema), c.createShipment);
router.get("/shipments", validate(v.shipmentListSchema, "query"), c.listShipments);
router.get("/shipments/:id", validate(v.ids, "params"), c.shipmentDetails);
router.put("/shipments/:id", validate(v.ids, "params"), validate(v.shipmentUpdateSchema), c.updateShipment);
router.get("/shipments/:id/history", validate(v.ids, "params"), c.shipmentHistory);
router.get("/shipments/:id/documents/:documentId/download", validate(v.documentIds, "params"), c.downloadDocument);
router.post("/shipments/:id/status", validate(v.ids, "params"), validate(v.statusSchema), c.updateStatus);
router.post("/shipments/:id/receive", validate(v.ids, "params"), validate(v.receiveSchema), c.receiveShipment);
router.post("/shipments/:id/lr-image", validate(v.ids, "params"), uploadLR, c.uploadLRImage);
router.post(
  "/shipments/:id/lr-image/verify",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.verifySchema),
  c.verifyLRImage,
);
router.post("/shipments/:id/lr-upload-token", validate(v.ids, "params"), c.createUploadToken);
router.post("/shipments/:id/complete", validate(v.ids, "params"), c.completeShipment);
router.post("/shipments/:id/close", allow(ROLES.ADMIN), validate(v.ids, "params"), c.closeShipment);
router.post(
  "/shipments/:id/admin-override",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.overrideSchema),
  c.adminOverride,
);

export default router;
