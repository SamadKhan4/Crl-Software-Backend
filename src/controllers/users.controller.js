import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as users from "../services/user.service.js";

export const createUser = asyncHandler(async (req, res) =>
  success(res, 201, "Team member created successfully", await users.createEmployee(req.body, req)),
);
export const listUsers = asyncHandler(async (req, res) =>
  successPaginated(res, "Team members fetched", await users.listEmployees(req.query, req)),
);
export const getUser = asyncHandler(async (req, res) =>
  success(res, 200, "Team member fetched", await users.getEmployee(req.params.id, req)),
);
export const updateUser = asyncHandler(async (req, res) =>
  success(res, 200, "Team member updated successfully", await users.updateEmployee(req.params.id, req.body, req)),
);
export const updateUserStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Team member status updated", await users.setEmployeeStatus(req.params.id, req.body.status, req)),
);
export const resetUserPassword = asyncHandler(async (req, res) => {
  await users.resetEmployeePassword(req.params.id, req.body.newPassword, req);
  success(res, 200, "Team member password reset successfully", null);
});
