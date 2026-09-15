import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import { Branch, Shipment } from "../models/index.js";
import { ROLES } from "../constants/workflow.js";
import { listActivity } from "../services/activity.service.js";
import { reportQuery, streamShipmentCsv } from "../services/report.service.js";

export const dashboard = asyncHandler(async (req, res) => {
  const filter =
    req.user.role === ROLES.ADMIN
      ? {}
      : { $or: [{ originBranchId: req.user.branchId }, { destinationBranchId: req.user.branchId }] };
  const [counts, todayShipments, monthlyShipments, branchWise] = await Promise.all([
    Shipment.aggregate([{ $match: filter }, { $group: { _id: "$currentStatus", count: { $sum: 1 } } }]),
    Shipment.countDocuments({ ...filter, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    Shipment.countDocuments({
      ...filter,
      createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    }),
    req.user.role !== ROLES.ADMIN
      ? []
      : Shipment.aggregate([
          { $match: filter },
          { $group: { _id: "$originBranchId", count: { $sum: 1 } } },
          { $lookup: { from: Branch.collection.name, localField: "_id", foreignField: "_id", as: "branch" } },
          { $unwind: "$branch" },
          { $project: { _id: 0, branch: "$branch.name", branchCode: "$branch.branchCode", count: 1 } },
        ]),
  ]);
  const map = Object.fromEntries(counts.map((item) => [item._id, item.count]));
  success(res, 200, "Dashboard summary fetched", {
    totalShipments: counts.reduce((total, item) => total + item.count, 0),
    booked: map.BOOKED || 0,
    inTransit: map.IN_TRANSIT || 0,
    received: map.RECEIVED || 0,
    lrImageUploaded: map.LR_IMAGE_UPLOADED || 0,
    lrImageVerified: map.LR_IMAGE_VERIFIED || 0,
    completed: map.COMPLETED || 0,
    closed: map.CLOSED || 0,
    cancelled: map.CANCELLED || 0,
    todayShipments,
    monthlyShipments,
    branchWise,
  });
});
export const shipmentReport = asyncHandler(async (req, res) => {
  const result = await reportQuery(req.query, req.user);
  res.json({
    success: true,
    message: "Shipment report fetched",
    data: result.items,
    pagination: result.pagination,
    summary: result.summary,
  });
});
export const exportShipments = asyncHandler(async (req, res) => streamShipmentCsv(req.query, req.user, res));

export const activity = asyncHandler(async (req, res) =>
  successPaginated(res, "Activity fetched", await listActivity(req.query, req.user)),
);
