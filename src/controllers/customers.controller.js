import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as customers from "../services/customer.service.js";

export const createCustomer = asyncHandler(async (req, res) =>
  success(res, 201, "Customer created successfully", await customers.createCustomer(req.body, req)),
);
export const listCustomers = asyncHandler(async (req, res) =>
  successPaginated(res, "Customers fetched", await customers.listCustomers(req.query)),
);
export const lookupCustomers = asyncHandler(async (req, res) =>
  success(res, 200, "Customer options fetched", await customers.lookupCustomers(req.query)),
);
export const getCustomer = asyncHandler(async (req, res) =>
  success(res, 200, "Customer fetched", await customers.getCustomer(req.params.id)),
);
export const getCustomerByCode = asyncHandler(async (req, res) =>
  success(res, 200, "Customer fetched", await customers.getCustomerByCode(req.params.customerCode)),
);
export const updateCustomer = asyncHandler(async (req, res) =>
  success(res, 200, "Customer updated successfully", await customers.updateCustomer(req.params.id, req.body, req)),
);
export const updateCustomerStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Customer status updated", await customers.setCustomerStatus(req.params.id, req.body.status, req)),
);
