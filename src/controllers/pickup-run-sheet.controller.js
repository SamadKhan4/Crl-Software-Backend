import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as service from "../services/pickup-run-sheet.service.js";

export const create = asyncHandler(async (req, res) =>
  success(res, 201, "Pickup run sheet created", await service.createPickupRunSheet(req.body, req)),
);
export const list = asyncHandler(async (req, res) =>
  successPaginated(res, "Pickup run sheets fetched", await service.listPickupRunSheets(req.query, req.user)),
);
export const detail = asyncHandler(async (req, res) =>
  success(res, 200, "Pickup run sheet fetched", await service.getPickupRunSheet(req.params.id, req.user)),
);
export const options = asyncHandler(async (req, res) =>
  success(res, 200, "PRS master options fetched", await service.pickupRunSheetOptions(req.user)),
);
export const addPickup = asyncHandler(async (req, res) =>
  success(res, 200, "PUR added to pickup run sheet", await service.addPickupToRunSheet(req.params.id, req.body, req)),
);
export const review = asyncHandler(async (req, res) =>
  success(res, 200, "PRS market rate reviewed", await service.reviewMarketRate(req.params.id, req.body, req)),
);
export const dispatch = asyncHandler(async (req, res) =>
  success(res, 200, "Pickup run sheet dispatched", await service.dispatchPickupRunSheet(req.params.id, req)),
);
