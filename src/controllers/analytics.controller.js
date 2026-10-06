import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import { Invoice, PackageUnit, Shipment, TmsRegister } from "../models/index.js";
import { listActivity } from "../services/activity.service.js";
import { reportQuery, streamShipmentCsv } from "../services/report.service.js";

export const dashboard = asyncHandler(async (req, res) => {
  const filter = {};
  const branchMatch = {};
  const [counts, todayShipments, monthlyShipments, locationWise, packageStats, revenueStats, costStats, vendorPayable] = await Promise.all([
    Shipment.aggregate([{ $match: filter }, { $group: { _id: "$currentStatus", count: { $sum: 1 } } }]),
    Shipment.countDocuments({ ...filter, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    Shipment.countDocuments({
      ...filter,
      createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    }),
    Shipment.aggregate([
      { $group: { _id: "$lrDetails.from", count: { $sum: 1 } } },
      { $project: { _id: 0, location: { $ifNull: ["$_id", "Nagpur"] }, count: 1 } },
    ]),
    PackageUnit.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { ...branchMatch, status: { $ne: "CANCELLED" } } }, { $group: { _id: null, revenue: { $sum: "$totalAmount" }, outstanding: { $sum: "$balanceAmount" } } }]),
    TmsRegister.aggregate([
      { $match: { ...branchMatch, module: { $in: ["PICKUP", "PTL", "FTL", "HANDLING", "ACCOUNTING"] }, status: { $ne: "CANCELLED" } } },
      { $group: { _id: null, cost: { $sum: { $add: ["$amount", "$taxAmount"] } } } },
    ]),
    TmsRegister.aggregate([{ $match: { ...branchMatch, module: "VENDOR_SETTLEMENT", status: { $nin: ["PAID", "CANCELLED"] } } }, { $group: { _id: null, payable: { $sum: "$amount" } } }]),
  ]);
  const map = Object.fromEntries(counts.map((item) => [item._id, item.count]));
  const packages = Object.fromEntries(packageStats.map((item) => [item._id, item.count]));
  const revenue = revenueStats[0]?.revenue || 0;
  const expense = (costStats[0]?.cost || 0) + (vendorPayable[0]?.payable || 0);
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
    locationWise,
    totalBoxes: packageStats.reduce((sum, item) => sum + item.count, 0),
    outForDeliveryBoxes: packages.OUT_FOR_DELIVERY || 0,
    deliveredBoxes: packages.DELIVERED || 0,
    exceptionBoxes: (packages.DAMAGE || 0) + (packages.SHORT || 0) + (packages.MISROUTE || 0) + (packages.HOLD || 0),
    revenue,
    expense,
    margin: revenue - expense,
    outstanding: revenueStats[0]?.outstanding || 0,
    vendorPayable: vendorPayable[0]?.payable || 0,
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
