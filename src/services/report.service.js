import mongoose from "mongoose";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { listQuery, paginated } from "../utils/query.js";
import { ROLES } from "../constants/workflow.js";
import { Shipment } from "../models/index.js";

const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export const buildReportFilter = (query, user) => ({
  ...(query.status && { currentStatus: query.status }),
  ...(query.customer && { customerId: new mongoose.Types.ObjectId(query.customer) }),
  ...(query.branch && {
    $or: [
      { originBranchId: new mongoose.Types.ObjectId(query.branch) },
      { destinationBranchId: new mongoose.Types.ObjectId(query.branch) },
    ],
  }),
  ...((query.dateFrom || query.dateTo) && {
    createdAt: { ...(query.dateFrom && { $gte: query.dateFrom }), ...(query.dateTo && { $lte: query.dateTo }) },
  }),
  ...(user.role !== ROLES.ADMIN && {
    $and: [{ $or: [{ originBranchId: user.branchId }, { destinationBranchId: user.branchId }] }],
  }),
});
export const reportQuery = async (query, user) => {
  const options = listQuery(query);
  const filter = buildReportFilter(query, user);
  const [items, counts] = await Promise.all([
    Shipment.find(filter)
      .select("lrNumber customerId originBranchId destinationBranchId currentStatus packageCount weightKg createdAt")
      .populate("customerId", "customerCode name companyName")
      .populate("originBranchId destinationBranchId", "branchCode name city")
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean(),
    Shipment.aggregate([{ $match: filter }, { $group: { _id: "$currentStatus", count: { $sum: 1 } } }]),
  ]);
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  return {
    ...paginated(items, total, options),
    summary: { total, statuses: Object.fromEntries(counts.map((item) => [item._id, item.count])) },
  };
};
export const streamShipmentCsv = async (query, user, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="crl-shipments-${new Date().toISOString().slice(0, 10)}.csv"`,
  );

  const cursor = Shipment.find(buildReportFilter(query, user))
    .select("lrNumber customerId originBranchId destinationBranchId currentStatus packageCount weightKg createdAt")
    .populate("customerId", "name")
    .populate("originBranchId destinationBranchId", "name city")
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor();
  async function* rows() {
    try {
      yield "LR Number,Customer,Origin,Destination,Status,Packages,Weight Kg,Booked At\n";
      for await (const item of cursor) {
        yield `${[item.lrNumber, item.customerId?.name, item.originBranchId?.name, item.destinationBranchId?.name, item.currentStatus, item.packageCount, item.weightKg, item.createdAt.toISOString()].map(escapeCsv).join(",")}\n`;
      }
    } finally {
      await cursor.close();
    }
  }
  // Pipeline applies backpressure and closes the cursor when a client disconnects.
  await pipeline(Readable.from(rows()), res);
};
