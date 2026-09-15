import { Router } from "express";
import * as c from "../controllers/users.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { ROLES } from "../constants/workflow.js";
import { allow } from "../middlewares/auth.js";
import { addResourceMutations } from "./resource-mutations.js";

const router = Router();
router.use("/managers", allow(ROLES.ADMIN), (req, _res, next) => {
  req.managementRole = ROLES.MANAGER;
  next();
});
router.post("/users", allow(ROLES.ADMIN, ROLES.MANAGER), validate(v.userSchema), c.createUser);
router.get("/users", allow(ROLES.ADMIN, ROLES.MANAGER), validate(v.listSchema, "query"), c.listUsers);
router.get("/users/:id", allow(ROLES.ADMIN, ROLES.MANAGER), validate(v.ids, "params"), c.getUser);
router.put(
  "/users/:id",
  allow(ROLES.ADMIN, ROLES.MANAGER),
  validate(v.ids, "params"),
  validate(v.userUpdateSchema),
  c.updateUser,
);
router.patch(
  "/users/:id/status",
  allow(ROLES.ADMIN, ROLES.MANAGER),
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.updateUserStatus,
);
router.post(
  "/users/:id/reset-password",
  allow(ROLES.ADMIN, ROLES.MANAGER),
  validate(v.ids, "params"),
  validate(v.resetPasswordSchema),
  c.resetUserPassword,
);

router.post("/managers", allow(ROLES.ADMIN), validate(v.userSchema), c.createUser);
router.get("/managers", allow(ROLES.ADMIN), validate(v.listSchema, "query"), c.listUsers);
router.get("/managers/:id", allow(ROLES.ADMIN), validate(v.ids, "params"), c.getUser);
router.put("/managers/:id", allow(ROLES.ADMIN), validate(v.ids, "params"), validate(v.userUpdateSchema), c.updateUser);
router.patch(
  "/managers/:id/status",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.updateUserStatus,
);
router.post(
  "/managers/:id/reset-password",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.resetPasswordSchema),
  c.resetUserPassword,
);

addResourceMutations(router, "users", v.employeePatchSchema, c.updateUser);
addResourceMutations(router, "managers", v.employeePatchSchema, c.updateUser);

export default router;
