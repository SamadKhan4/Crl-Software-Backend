import { Branch } from "../models/branch.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as branches from "../services/branch.service.js";
import { searchDestinations } from "../services/destination.service.js";

export const destinationOptions = asyncHandler(async (req, res) =>
  success(res, 200, "Vidarbha destinations fetched", await searchDestinations(String(req.query.search || "").slice(0, 100))),
);

export const createBranch = asyncHandler(async (req, res) =>
  success(res, 201, "Branch created successfully", await branches.createBranch(req.body, req)),
);
export const listBranches = asyncHandler(async (req, res) =>
  successPaginated(res, "Branches fetched", await branches.listBranches(req.query, req.user)),
);
export const getBranch = asyncHandler(async (req, res) =>
  success(res, 200, "Branch fetched", await branches.getBranch(req.params.id, req.user)),
);
export const updateBranch = asyncHandler(async (req, res) =>
  success(res, 200, "Branch updated successfully", await branches.updateBranch(req.params.id, req.body, req)),
);
export const updateBranchStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Branch status updated", await branches.setBranchStatus(req.params.id, req.body.status, req)),
);

export const branchOptions = asyncHandler(async (_req, res) =>
  success(
    res,
    200,
    "Active branch options fetched",
    await Branch.find({ status: "ACTIVE" }).select("branchCode name city pincode address").sort({ name: 1 }).lean(),
  ),
);
