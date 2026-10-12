import { Branch, Customer, Shipment, PackageUnit, Trip, DeliveryRunSheet, Invoice, MovementLeg } from "../models/index.js";
import { LetterAuthorization } from "../models/authorization.model.js";
import { escapeSearch } from "../utils/query.js";
import mongoose from "mongoose";
const oid = (value) => new mongoose.Types.ObjectId(value);
const n = (field) => ({ $ifNull: [field, 0] });
const days = (field) => ({ $cond: [field, { $max: [0, { $floor: { $divide: [{ $subtract: ["$$NOW", field] }, 86400000] } }] }, null] });
const lookup = (model, local, as, foreign = "_id") => ({ $lookup: { from: model.collection.name, localField: local, foreignField: foreign, as } });
const join = (model, local, as) => [lookup(model, local, as), { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } }];
const dateMatch = (field, from, to) => {
  if (!from && !to) return [];
  return [{ $match: { [field]: { ...(from && { $gte: new Date(`${from}T00:00:00+05:30`) }), ...(to && { $lt: new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400000) }) } } }];
};
const columns = (text) => text.split("|").map((entry) => { const [key, label, type] = entry.split(":"); return { key, label, type: type || "text" }; });
const shipmentColumns = "lrNumber:LR Number|date:Booking Date:date|customer:Customer|sender:Consignor|receiver:Consignee|origin:Origin|destination:Destination|location:Current Godown|storage:Rack / Bay|quantity:Packages:number|weight:Weight (kg):number|receivedDate:Stock Entry:date|days:Days in Stock:number|status:Status|bucket:Ageing Category|delayReason:Recorded Delay Reason";
export const definitions = {
  "godown-stock": { columns: columns(shipmentColumns), metrics: { records: "In-stock Consignments", quantity: "Packages", weight: "Weight (kg)", pending: "Pending Dispatch" } },
  "stock-ageing": { columns: columns(shipmentColumns + "|lastMovement:Last Movement:date"), metrics: { records: "Ageing Consignments", quantity: "Packages", aboveThreshold: "Above Threshold", longest: "Longest Days in Stock" } },
  "hub-in-transits": { columns: columns("lrNumber:LR Number|tripNumber:Trip|origin:Origin Hub / City|destination:Destination Hub / City|vehicle:Vehicle|driver:Driver|date:Dispatched:date|expected:Expected Arrival:date|actual:Actual Arrival:date|quantity:Packages:number|weight:Weight (kg):number|transitHours:Transit Hours:number|delayHours:Delay Hours:number|status:Status"), metrics: { records: "Consignments", quantity: "Packages", inTransit: "In Transit", delayed: "Delayed", received: "Received" } },
  "drs-details": { columns: columns("number:DRS Number|date:Delivery Date:date|branch:Branch|employee:Delivery Person|vehicle:Vehicle|assigned:Assigned:number|delivered:Delivered:number|pending:Pending:number|failed:Failed:number|status:Status"), metrics: { records: "DRS Records", assigned: "Assigned Shipments", delivered: "Delivered", pending: "Pending", failed: "Failed" } },
  "invoice-details": { columns: columns("number:Invoice Number|date:Invoice Date:date|customer:Customer|branch:Billing Branch|lrNumbers:LR References|freight:Booked Freight:number|additional:Additional Taxable Charges:number|taxable:Final Taxable Amount:number|gst:GST:number|total:Invoice Total:number|paid:Posted Payments:number|balance:Balance:number|dueDate:Due Date:date|status:Payment Status"), metrics: { records: "Invoices", total: "Invoiced Amount", paid: "Posted Payments", balance: "Outstanding" } },
  "branch-outstanding": { columns: columns("branch:Branch|code:Branch Code|total:Invoiced:number|paid:Posted Payments:number|balance:Outstanding:number|overdue:Overdue:number|pending:Pending Invoices:number|oldest:Oldest Pending Invoice:date|notDue:Not Due:number|age30:0-30 Days Overdue:number|age60:31-60 Days Overdue:number|age90:61-90 Days Overdue:number|ageMore:90+ Days Overdue:number|noDue:Due Date Missing:number"), metrics: { balance: "Outstanding", overdue: "Overdue", customers: "Customers with Balances", overdueInvoices: "Overdue Invoices" } },
  "customer-business": { columns: columns("customer:Customer|code:Customer Code|consignments:LR Count:number|quantity:Packages:number|weight:Weight (kg):number|volume:Shipment Volume:number|freight:Booked Freight:number|additional:Booked Additional Charges:number|total:Invoiced Amount:number|paid:Posted Payments:number|balance:Outstanding:number|date:Last Booking:date|previousFreight:Previous Period Booked Freight:number|freightChange:Freight Change:number"), metrics: { records: "Customers", consignments: "Consignments", freight: "Booked Freight", total: "Invoiced Amount", paid: "Posted Payments", balance: "Outstanding" } },
  "branch-loa": { columns: columns("number:LOA Number|branch:Branch|authorizedTo:Authorized Person / Organization|purpose:Purpose|date:Issue Date:date|effectiveFrom:Effective From:date|validUntil:Valid Until:date|reference:Document Reference|status:Status"), metrics: { records: "Authorizations", active: "Active", expired: "Expired", revoked: "Revoked" } },
  "unbilled-details": { columns: columns("lrNumber:LR Number|date:Booking Date:date|customer:Customer|branch:Billing Branch|origin:Origin|destination:Destination|status:Delivery Status|freight:Estimated Freight:number|additional:Estimated Additional Charges:number|estimated:Estimated Billable Amount:number|days:Pending Days:number|reason:Billing Eligibility / Reason"), metrics: { records: "Unbilled Credit LRs", estimated: "Estimated Billable Amount", delivered: "Delivered Unbilled", longest: "Oldest Pending Days" } },
};
const charges = { freight: n("$lrDetails.freightCharges"), additional: { $max: [0, { $subtract: [{ $subtract: [n("$lrDetails.totalAmount"), n("$lrDetails.gstAmount")] }, n("$lrDetails.freightCharges")] }] } };
const stockBucket = { $switch: { branches: [[3, "0-3"], [7, "4-7"], [15, "8-15"], [30, "16-30"]].map(([max, value]) => ({ case: { $lte: ["$days", max] }, then: value })), default: "30+" } };
function stockPipeline(query) {
  // Stock entry comes from receipt scans for the CURRENT custodian, never booking date.
  return [
    { $match: { ...(query.branch && { currentCustodianId: query.branch }), currentCustodianType: "BRANCH", status: { $in: ["HUB_INWARD", "UNLOADED", "SORTED", "HOLD", "DAMAGE", "EXCESS"] } } },
    { $set: { receipt: { $max: { $map: { input: { $filter: { input: "$scans", as: "scan", cond: { $and: [{ $in: ["$$scan.action", ["HUB_INWARD", "UNLOADED"]] }, { $eq: [{ $toString: "$$scan.branchId" }, "$currentCustodianId"] }] } } }, as: "scan", in: "$$scan.scannedAt" } } } } },
    { $group: { _id: { shipment: "$shipmentId", custodian: "$currentCustodianId", location: "$currentLocation" }, quantity: { $sum: 1 }, receipt: { $min: "$receipt" }, lastMovement: { $max: "$updatedAt" } } },
    ...join(Shipment, "_id.shipment", "shipment"),
    ...join(MovementLeg, "shipment.activeMovementLegId", "currentLeg"),
    { $match: { "shipment.currentStatus": { $nin: ["COMPLETED", "CLOSED", "CANCELLED"] }, "shipment.lastMileState": { $ne: "OUT_FOR_DELIVERY" } } },
    { $set: { branchId: { $convert: { input: "$_id.custodian", to: "objectId", onError: null, onNull: null } }, customerId: "$shipment.customerId", destinationId: "$shipment.destinationBranchId", receivedDate: { $ifNull: ["$receipt", { $cond: [{ $eq: ["$shipment.currentHubId", { $convert: { input: "$_id.custodian", to: "objectId", onError: null, onNull: null } }] }, { $ifNull: ["$shipment.destinationInwardAt", "$shipment.receivedAt"] }, null] }] } } },
    { $set: { receivedDate: { $max: ["$receivedDate", { $cond: [{ $eq: ["$currentLeg.toHubId", "$branchId"] }, "$currentLeg.arrivedAt", null] }] } } },
    ...join(Branch, "branchId", "godown"), ...join(Customer, "customerId", "client"),
    ...join(Branch, "shipment.originBranchId", "originBranch"), ...join(Branch, "destinationId", "destBranch"),
    { $set: { days: days("$receivedDate") } },
    { $project: { _id: 0, id: { $concat: [{ $toString: "$shipment._id" }, ":", "$_id.custodian", ":", { $ifNull: ["$_id.location", ""] }] }, shipmentId: "$shipment._id", branchId: 1, customerId: 1, destinationId: 1, lrNumber: "$shipment.lrNumber", date: { $ifNull: ["$shipment.lrDetails.bookingDate", "$shipment.createdAt"] }, customer: "$client.name", sender: "$shipment.senderName", receiver: "$shipment.receiverName", origin: { $ifNull: ["$shipment.lrDetails.from", "$originBranch.name"] }, destination: { $ifNull: ["$shipment.lrDetails.to", "$destBranch.name"] }, location: { $ifNull: ["$_id.location", "$godown.name"] }, storage: "$shipment.storageLocation", quantity: 1, weight: { $multiply: ["$shipment.weightKg", { $divide: ["$quantity", "$shipment.packageCount"] }] }, receivedDate: 1, days: 1, bucket: { $cond: [{ $eq: ["$days", null] }, "UNKNOWN", stockBucket] }, status: "$shipment.currentStatus", delayReason: "$shipment.movementHold.reason", pending: { $literal: 1 }, aboveThreshold: { $cond: [{ $gt: ["$days", query.threshold] }, 1, 0] }, longest: "$days", lastMovement: 1 } },
  ];
}
function invoicePipeline(query) {
  return [{ $match: { ...(query.branch && { branchId: oid(query.branch) }), ...(query.customer && { customerId: oid(query.customer) }), status: { $nin: ["DRAFT", "CANCELLED"] } } },
    ...dateMatch("issueDate", query.dateFrom, query.dateTo), ...dateMatch("dueDate", query.dueFrom, query.dueTo),
    ...join(Branch, "branchId", "office"), ...join(Customer, "customerId", "client"), lookup(Shipment, "shipmentIds", "lrs"),
    { $project: { id: "$_id", branchId: 1, customerId: 1, branch: "$office.name", code: "$office.branchCode", customer: "$client.name", number: "$invoiceNumber", date: "$issueDate", dueDate: 1, lrNumbers: { $map: { input: "$lineItems", as: "line", in: "$$line.lrNumber" } }, freight: { $sum: "$lrs.lrDetails.freightCharges" }, additional: { $max: [0, { $subtract: ["$subtotal", { $sum: "$lrs.lrDetails.freightCharges" }] }] }, taxable: "$subtotal", gst: "$gstAmount", total: "$totalAmount", paid: "$paidAmount", balance: "$balanceAmount", status: 1 } },
    { $set: { overdueDays: days("$dueDate"), overdue: { $cond: [{ $and: ["$dueDate", { $lt: ["$dueDate", "$$NOW"] }] }, "$balance", 0] }, bucket: { $switch: { branches: [{ case: { $eq: [{ $ifNull: ["$dueDate", null] }, null] }, then: "NO_DUE_DATE" }, { case: { $gte: ["$dueDate", "$$NOW"] }, then: "NOT_DUE" }, ...[[30, "0-30"], [60, "31-60"], [90, "61-90"]].map(([max, value]) => ({ case: { $lte: [days("$dueDate"), max] }, then: value }))], default: "90+" } } } },
  ];
}
export function reportSource(report, query) {
  if (["godown-stock", "stock-ageing"].includes(report)) return { model: PackageUnit, pipeline: stockPipeline(query), dateField: "receivedDate" };
  if (["invoice-details", "branch-outstanding"].includes(report)) return { model: Invoice, pipeline: invoicePipeline(query), dateField: "date" };
  if (report === "hub-in-transits") return { model: Trip, dateField: "date", pipeline: [
    { $match: { tripType: "MIDDLE_MILE", status: { $in: ["DISPATCHED", "ARRIVED", "CLOSED"] } } },
    { $unwind: "$shipmentIds" }, ...join(Shipment, "shipmentIds", "lr"),
    { $project: { id: { $concat: [{ $toString: "$_id" }, ":", { $toString: "$shipmentIds" }] }, shipmentId: "$shipmentIds", tripId: "$_id", branchId: "$fromHubId", destinationId: "$toHubId", customerId: "$lr.customerId", lrNumber: "$lr.lrNumber", tripNumber: 1, origin: 1, destination: 1, vehicle: "$vehicleNumber", driver: "$driverName", date: { $ifNull: ["$dispatchedAt", "$departureDate"] }, expected: "$expectedArrival", actual: "$arrivedAt", quantity: "$lr.packageCount", weight: "$lr.weightKg", status: { $cond: [{ $in: ["$status", ["ARRIVED", "CLOSED"]] }, "ARRIVED", { $cond: [{ $and: ["$expectedArrival", { $lt: ["$expectedArrival", "$$NOW"] }] }, "DELAYED", "IN_TRANSIT"] }] } } },
    { $set: { transitHours: { $round: [{ $divide: [{ $subtract: [{ $ifNull: ["$actual", "$$NOW"] }, "$date"] }, 3600000] }, 1] }, delayHours: { $cond: ["$expected", { $round: [{ $max: [0, { $divide: [{ $subtract: [{ $ifNull: ["$actual", "$$NOW"] }, "$expected"] }, 3600000] }] }, 1] }, null] }, inTransit: { $cond: [{ $in: ["$status", ["IN_TRANSIT", "DELAYED"]] }, 1, 0] }, delayed: { $cond: [{ $eq: ["$status", "DELAYED"] }, 1, 0] }, received: { $cond: [{ $eq: ["$status", "ARRIVED"] }, 1, 0] } } },
  ] };
  if (report === "drs-details") return { model: DeliveryRunSheet, dateField: "date", pipeline: [
    ...join(Branch, "branchId", "office"),
    { $lookup: { from: "users", localField: "deliveryAgentId", foreignField: "_id", as: "agent" } },
    { $project: { id: "$_id", branchId: 1, employeeId: "$deliveryAgentId", number: "$drsNumber", date: "$deliveryDate", branch: "$office.name", employee: { $ifNull: [{ $arrayElemAt: ["$agent.name", 0] }, "$driverName"] }, vehicle: "$vehicleNumber", assigned: { $size: { $ifNull: ["$shipmentIds", []] } }, delivered: { $size: { $filter: { input: { $ifNull: ["$items", []] }, as: "item", cond: { $eq: ["$$item.attemptStatus", "DELIVERED"] } } } }, failed: { $size: { $filter: { input: { $ifNull: ["$items", []] }, as: "item", cond: { $in: ["$$item.attemptStatus", ["UNDELIVERED", "REATTEMPT"]] } } } }, status: 1 } },
    { $set: { pending: { $subtract: ["$assigned", { $add: ["$delivered", "$failed"] }] } } },
  ] };
  if (report === "branch-loa") return { model: LetterAuthorization, dateField: "date", pipeline: [
    ...join(Branch, "branchId", "office"),
    { $project: { id: "$_id", branchId: 1, number: "$loaNumber", branch: "$office.name", authorizedTo: 1, purpose: 1, date: "$issueDate", effectiveFrom: 1, validUntil: 1, dueDate: "$validUntil", reference: "$documentReference", hasDocument: { $or: [{ $gt: [{ $strLenCP: { $ifNull: ["$document.storageKey", ""] } }, 0] }, { $gt: [{ $strLenCP: { $ifNull: ["$document.fileUrl", ""] } }, 0] }] }, status: { $switch: { branches: [{ case: "$revokedAt", then: "REVOKED" }, { case: { $lt: ["$validUntil", "$$NOW"] }, then: "EXPIRED" }, { case: { $gt: ["$effectiveFrom", "$$NOW"] }, then: "SCHEDULED" }], default: "ACTIVE" } } } },
    ...dateMatch("validUntil", query.dueFrom, query.dueTo),
    { $set: Object.fromEntries(["active", "expired", "revoked"].map((key) => [key, { $cond: [{ $eq: ["$status", key.toUpperCase()] }, 1, 0] }])) },
  ] };
  if (report === "unbilled-details") return { model: Shipment, dateField: "date", pipeline: [
    { $match: { currentStatus: { $ne: "CANCELLED" } } }, ...join(Customer, "customerId", "client"),
    { $match: { "client.customerType": "CREDIT", "client.status": "ACTIVE" } },
    { $lookup: { from: Invoice.collection.name, let: { shipment: "$_id" }, pipeline: [{ $match: { $expr: { $and: [{ $in: ["$$shipment", "$shipmentIds"] }, { $ne: ["$status", "CANCELLED"] }] } } }, { $limit: 1 }], as: "bills" } }, { $match: { "bills.0": { $exists: false } } },
    ...join(Branch, "originBranchId", "office"),
    { $project: { id: "$_id", shipmentId: "$_id", customerId: 1, branchId: "$originBranchId", destinationId: "$destinationBranchId", lrNumber: 1, date: { $ifNull: ["$lrDetails.bookingDate", "$createdAt"] }, customer: "$client.name", branch: "$office.name", origin: "$lrDetails.from", destination: "$lrDetails.to", status: "$currentStatus", ...charges, estimated: n("$lrDetails.totalAmount"), days: days({ $ifNull: ["$lrDetails.bookingDate", "$createdAt"] }), delivered: { $cond: [{ $in: ["$currentStatus", ["COMPLETED", "CLOSED"]] }, 1, 0] }, eligible: { $and: [{ $in: ["$currentStatus", ["COMPLETED", "CLOSED"]] }, { $gt: [n("$lrDetails.totalAmount"), n("$lrDetails.gstAmount")] }] }, reason: { $cond: [{ $in: ["$currentStatus", ["COMPLETED", "CLOSED"]] }, { $cond: [{ $gt: [n("$lrDetails.totalAmount"), n("$lrDetails.gstAmount")] }, "Eligible for invoice generation", "Billable charges missing"] }, "Delivery completion required"] } } }, { $set: { longest: "$days" } },
  ] };
  // Customer totals keep booked freight, finalized invoices and allocated payments distinct.
  const shipmentMatch = { currentStatus: { $ne: "CANCELLED" }, ...(query.branch && { originBranchId: oid(query.branch) }), ...(query.status && { currentStatus: query.status }) };
  const selectedPeriod = dateMatch("bookingDate", query.dateFrom, query.dateTo);
  let previousPeriod = [{ $match: { _id: null } }];
  if (query.dateFrom && query.dateTo) {
    const end = new Date(`${query.dateFrom}T00:00:00+05:30`); const length = new Date(`${query.dateTo}T00:00:00+05:30`).getTime() + 86400000 - end.getTime();
    previousPeriod = [{ $match: { bookingDate: { $gte: new Date(end.getTime() - length), $lt: end } } }];
  }
  return { model: Customer, dateField: null, pipeline: [
    ...(query.customer ? [{ $match: { _id: oid(query.customer) } }] : []),
    { $lookup: { from: Shipment.collection.name, let: { customer: "$_id" }, pipeline: [{ $match: { ...shipmentMatch, $expr: { $eq: ["$customerId", "$$customer"] } } }, { $set: { bookingDate: { $ifNull: ["$lrDetails.bookingDate", "$createdAt"] } } }, ...selectedPeriod, { $group: { _id: null, consignments: { $sum: 1 }, quantity: { $sum: "$packageCount" }, weight: { $sum: "$weightKg" }, volume: { $sum: "$lrDetails.volume" }, freight: { $sum: "$lrDetails.freightCharges" }, additional: { $sum: charges.additional }, date: { $max: "$bookingDate" } } }], as: "bookings" } },
    { $lookup: { from: Shipment.collection.name, let: { customer: "$_id" }, pipeline: [{ $match: { ...shipmentMatch, $expr: { $eq: ["$customerId", "$$customer"] } } }, { $set: { bookingDate: { $ifNull: ["$lrDetails.bookingDate", "$createdAt"] } } }, ...previousPeriod, { $group: { _id: null, freight: { $sum: "$lrDetails.freightCharges" } } }], as: "previous" } },
    { $lookup: { from: Invoice.collection.name, let: { customer: "$_id" }, pipeline: [{ $match: { status: { $nin: ["DRAFT", "CANCELLED"] }, ...(query.branch && { branchId: oid(query.branch) }), $expr: { $eq: ["$customerId", "$$customer"] } } }, ...dateMatch("issueDate", query.billingFrom || query.dateFrom, query.billingTo || query.dateTo), { $group: { _id: null, total: { $sum: "$totalAmount" }, paid: { $sum: "$paidAmount" }, balance: { $sum: "$balanceAmount" } } }], as: "bills" } },
    { $set: { booking: { $arrayElemAt: ["$bookings", 0] }, bill: { $arrayElemAt: ["$bills", 0] } } },
    { $match: { $or: [{ "booking.consignments": { $gt: 0 } }, { "bill.total": { $gt: 0 } }] } },
    { $project: { id: "$_id", customerId: "$_id", customer: "$name", code: "$customerCode", ...Object.fromEntries(["consignments", "quantity", "weight", "volume", "freight", "additional", "date"].map((key) => [key, key === "date" ? "$booking.date" : n(`$booking.${key}`)])), total: n("$bill.total"), paid: n("$bill.paid"), balance: n("$bill.balance"), previousFreight: query.dateFrom && query.dateTo ? n({ $arrayElemAt: ["$previous.freight", 0] }) : { $literal: null } } },
    { $set: { freightChange: { $cond: [{ $ne: ["$previousFreight", null] }, { $subtract: ["$freight", "$previousFreight"] }, null] } } },
  ] };
}
export function buildMisPipeline(report, query) {
  const { model, pipeline, dateField } = reportSource(report, query);
  if (dateField) pipeline.push(...dateMatch(dateField, query.dateFrom, query.dateTo));
  const filter = {};
  for (const [key, field] of [["branch", "branchId"], ["destination", "destinationId"], ["customer", "customerId"], ["employee", "employeeId"]]) {
    if (query[key] && report !== "customer-business") filter[field] = oid(query[key]);
  }
  if (query.status && report !== "customer-business") filter.status = query.status;
  if (query.bucket) filter.bucket = query.bucket;
  if (query.minDays !== undefined) filter.days = { $gte: query.minDays };
  if (query.vehicle) filter.vehicle = { $regex: escapeSearch(query.vehicle), $options: "i" };
  if (query.search) filter.$or = definitions[report].columns.filter((c) => c.type === "text").map(({ key }) => ({ [key]: { $regex: escapeSearch(query.search), $options: "i" } }));
  pipeline.push({ $match: filter });
  if (report === "branch-outstanding") {
    pipeline.push({ $match: { balance: { $gt: 0 } } }, { $group: { _id: "$branchId", branch: { $first: "$branch" }, code: { $first: "$code" }, total: { $sum: "$total" }, paid: { $sum: "$paid" }, balance: { $sum: "$balance" }, overdue: { $sum: "$overdue" }, pending: { $sum: 1 }, oldest: { $min: "$date" }, customerIds: { $addToSet: "$customerId" }, overdueInvoices: { $sum: { $cond: [{ $gt: ["$overdue", 0] }, 1, 0] } }, ...Object.fromEntries([["notDue", "NOT_DUE"], ["age30", "0-30"], ["age60", "31-60"], ["age90", "61-90"], ["ageMore", "90+"], ["noDue", "NO_DUE_DATE"]].map(([key, bucket]) => [key, { $sum: { $cond: [{ $eq: ["$bucket", bucket] }, "$balance", 0] } }])) } }, { $set: { id: "$_id", customers: { $size: "$customerIds" } } });
  }
  const moneyFields = new Set(["freight", "additional", "taxable", "gst", "total", "paid", "balance", "overdue", "notDue", "age30", "age60", "age90", "ageMore", "noDue", "estimated", "previousFreight", "freightChange"]);
  const moneyColumns = definitions[report].columns.filter((column) => moneyFields.has(column.key));
  if (moneyColumns.length) pipeline.push({ $set: Object.fromEntries(moneyColumns.map(({ key }) => [key, { $round: [`$${key}`, 2] }])) });
  return { model, pipeline };
}
export async function misReport(report, query) {
  const { model, pipeline } = buildMisPipeline(report, query);
  const definition = definitions[report];
  const validSort = definition.columns.some((column) => column.key === query.sortBy) ? query.sortBy : definition.columns[0].key;
  const summaryGroup = { _id: null, records: { $sum: 1 } };
  for (const key of Object.keys(definition.metrics)) if (key !== "records") summaryGroup[key] = { [key === "longest" ? "$max" : "$sum"]: `$${key}` };
  if (report === "branch-outstanding") summaryGroup.customerSets = { $push: "$customerIds" };
  const [result] = await model.aggregate([...pipeline, { $facet: {
    rows: [{ $sort: { [validSort]: query.sortOrder === "asc" ? 1 : -1, id: 1 } }, { $skip: (query.page - 1) * query.limit }, { $limit: query.limit }, { $project: { _id: 0, customerIds: 0 } }],
    summary: [{ $group: summaryGroup }],
  } }]).allowDiskUse(true);
  const summary = result.summary[0] || {};
  if (summary.customerSets) { summary.customers = new Set(summary.customerSets.flat().map(String)).size; delete summary.customerSets; }
  delete summary._id;
  for (const key of ["freight", "additional", "taxable", "gst", "total", "paid", "balance", "overdue", "estimated"]) {
    if (typeof summary[key] === "number") summary[key] = Math.round((summary[key] + Number.EPSILON) * 100) / 100;
  }
  return { rows: result.rows, columns: definition.columns, metrics: definition.metrics, summary, pagination: { page: query.page, limit: query.limit, total: summary.records || 0, totalPages: Math.ceil((summary.records || 0) / query.limit) } };
}
export const csvCell = (value) => {
  const text = Array.isArray(value) ? value.join(", ") : value instanceof Date ? value.toISOString() : String(value ?? "");
  return `"${(/^[\s]*[=+@\-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
};
export async function exportMisReport(report, query, res) {
  const { model, pipeline } = buildMisPipeline(report, query);
  const cols = definitions[report].columns;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="crl-${report}.csv"`);
  const sortKey = cols.some((column) => column.key === query.sortBy) ? query.sortBy : cols[0].key;
  const cursor = model.aggregate([...pipeline, { $sort: { [sortKey]: query.sortOrder === "asc" ? 1 : -1, id: 1 } }]).allowDiskUse(true).cursor({ batchSize: 100 });
  const { Readable } = await import("node:stream"); const { pipeline: streamPipeline } = await import("node:stream/promises");
  async function* rows() {
    try { yield "\ufeff" + cols.map((c) => csvCell(c.label)).join(",") + "\n";
      for await (const row of cursor) yield cols.map((c) => csvCell(row[c.key])).join(",") + "\n";
    } finally { await cursor.close(); }
  }
  await streamPipeline(Readable.from(rows()), res);
}
