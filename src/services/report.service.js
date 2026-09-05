import { ROLES } from "../constants/workflow.js";
import { Shipment } from "../models/index.js";

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export const buildReportFilter = (query, user) => ({
  ...(query.status && { currentStatus: query.status }),
  ...(query.customer && { customerId: query.customer }),
  ...(query.branch && { $or: [{ originBranchId: query.branch }, { destinationBranchId: query.branch }] }),
  ...((query.dateFrom || query.dateTo) && {
    createdAt: { ...(query.dateFrom && { $gte: query.dateFrom }), ...(query.dateTo && { $lte: query.dateTo }) },
  }),
  ...(user.role !== ROLES.ADMIN && {
    $and: [{ $or: [{ originBranchId: user.branchId }, { destinationBranchId: user.branchId }] }],
  }),
});
export const reportQuery = (query, user) =>
  Shipment.find(buildReportFilter(query, user))
    .select("lrNumber customerId originBranchId destinationBranchId currentStatus packageCount weightKg createdAt")
    .populate("customerId", "customerCode name companyName")
    .populate("originBranchId destinationBranchId", "branchCode name city")
    .sort({ createdAt: -1 })
    .lean();
export const streamShipmentCsv = async (query, user, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="crl-shipments-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.write("LR Number,Customer,Origin,Destination,Status,Packages,Weight Kg,Booked At\n");
  const cursor = Shipment.find(buildReportFilter(query, user))
    .populate("customerId", "name")
    .populate("originBranchId destinationBranchId", "name city")
    .sort({ createdAt: -1 })
    .cursor();
  for await (const item of cursor) {
    const row = [
      item.lrNumber,
      item.customerId?.name,
      item.originBranchId?.name,
      item.destinationBranchId?.name,
      item.currentStatus,
      item.packageCount,
      item.weightKg,
      item.createdAt.toISOString(),
    ];
    res.write(`${row.map(escapeCsv).join(",")}\n`);
  }
  res.end();
};
