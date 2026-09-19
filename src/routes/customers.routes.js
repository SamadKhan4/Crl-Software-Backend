import { Router } from "express";
import * as c from "../controllers/customers.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { addResourceMutations } from "./resource-mutations.js";
import { ROLES } from "../constants/workflow.js";
import { allow } from "../middlewares/auth.js";

const router = Router();
const adminManager = allow(ROLES.ADMIN, ROLES.MANAGER);
router.get("/customers/lookup", validate(v.listSchema, "query"), c.lookupCustomers);
router.post("/customers", adminManager, validate(v.customerSchema), c.createCustomer);
router.get("/customers", adminManager, validate(v.listSchema, "query"), c.listCustomers);
router.get("/customers/code/:customerCode", adminManager, validate(v.customerCodeParams, "params"), c.getCustomerByCode);
router.get("/customers/:id", adminManager, validate(v.ids, "params"), c.getCustomer);
router.put("/customers/:id", adminManager, validate(v.ids, "params"), validate(v.customerSchema), c.updateCustomer);
router.patch(
  "/customers/:id/status",
  adminManager,
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.updateCustomerStatus,
);

addResourceMutations(router, "customers", v.customerUpdateSchema, c.updateCustomer);

export default router;
