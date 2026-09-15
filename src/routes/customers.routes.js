import { Router } from "express";
import * as c from "../controllers/customers.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { addResourceMutations } from "./resource-mutations.js";

const router = Router();
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

addResourceMutations(router, "customers", v.customerUpdateSchema, c.updateCustomer);

export default router;
