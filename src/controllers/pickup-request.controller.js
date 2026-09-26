import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as service from "../services/pickup-request.service.js";

export const create = asyncHandler(async (req, res) =>
  success(res, 201, "Pickup request created", await service.createPickupRequest(req.body, req)),
);
export const list = asyncHandler(async (req, res) =>
  successPaginated(res, "Pickup requests fetched", await service.listPickupRequests(req.query, req.user)),
);
export const agentLrs = asyncHandler(async (req, res) =>
  successPaginated(res, "Agent LRs fetched", await service.listAgentLrs(req.query, req.user)),
);
export const summary = asyncHandler(async (req, res) =>
  success(res, 200, "Pickup request summary fetched", await service.pickupRequestSummary(req.user)),
);
export const detail = asyncHandler(async (req, res) =>
  success(res, 200, "Pickup request fetched", await service.getPickupRequest(req.params.id, req.user)),
);
export const updateStatus = asyncHandler(async (req, res) =>
  success(
    res,
    200,
    "Pickup request status updated",
    await service.updatePickupRequestStatus(req.params.id, req.body, req),
  ),
);
export const assignAgent = asyncHandler(async (req, res) =>
  success(
    res,
    200,
    "Pickup agent assigned",
    await service.assignPickupAgent(req.params.id, req.body, req),
  ),
);
