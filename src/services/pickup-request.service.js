import mongoose from "mongoose";
import { ACTIVE, ROLES } from "../constants/workflow.js";
import { Branch, Customer, Notification, PickupRequest, Shipment, Vendor } from "../models/index.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });
const branchFilter = (user) =>
  user.role === ROLES.ADMIN ? {} : user.branchId ? { branchId: user.branchId } : { _id: null };

export async function createPickupRequest(data, req) {
  const branchId = req.user.role === ROLES.ADMIN ? data.branchId || req.user.branchId : req.user.branchId;
  const [branch, customer] = await Promise.all([
    branchId ? Branch.exists({ _id: branchId, status: ACTIVE.ACTIVE }) : true,
    data.customerId
      ? Customer.findOne({ _id: data.customerId, status: ACTIVE.ACTIVE }).select("customerType").lean()
      : null,
  ]);
  if (!branch) throw new ConflictError("Select an active branch", "INVALID_PICKUP_BRANCH");
  if (data.customerId && customer?.customerType !== "CREDIT")
    throw new ConflictError("Pickup access is available only for active credit clients", "INVALID_PICKUP_CLIENT");

  const session = await mongoose.startSession();
  try {
    let record;
    await session.withTransaction(async () => {
      record = (
        await PickupRequest.create(
          [
            {
              ...data,
              branchId,
              pickupRequestNumber: await generateBusinessNumber("pickup-request", "PUR", session),
              createdBy: req.user._id,
              createdSource: "INTERNAL",
            },
          ],
          { session },
        )
      )[0];
      await Notification.create(
        [
          {
            event: "PICKUP_REQUEST_CREATED",
            pickupRequestId: record._id,
            customerId: record.customerId,
            branchId: record.branchId,
            recipientName: record.shipper.contactName,
            mobile: record.shipper.contactMobile,
            channels: ["WHATSAPP", "SMS"],
            subject: "Pickup request generated",
            message: `Pickup request ${record.pickupRequestNumber} has been generated for ${record.shipper.companyName}. Service: ${record.serviceType}. Boxes: ${record.totalBoxes}, weight: ${record.totalWeightKg} kg.`,
          },
        ],
        { session },
      );
      await audit(session, req, "PICKUP_REQUEST_CREATED", "PickupRequest", record._id, null, {
        pickupRequestNumber: record.pickupRequestNumber,
        status: record.status,
      });
    });
    return dto(record);
  } finally {
    await session.endSession();
  }
}

export async function listPickupRequests(query, user) {
  const options = listQuery(query);
  const filter = branchFilter(user);
  if (query.status) filter.status = query.status;
  if (query.search)
    filter.$or = [
      { pickupRequestNumber: { $regex: escapeSearch(query.search), $options: "i" } },
      { "shipper.companyName": { $regex: escapeSearch(query.search), $options: "i" } },
      { "recipient.companyName": { $regex: escapeSearch(query.search), $options: "i" } },
      { "shipper.city": { $regex: escapeSearch(query.search), $options: "i" } },
      { "recipient.city": { $regex: escapeSearch(query.search), $options: "i" } },
    ];
  const [items, total] = await Promise.all([
    PickupRequest.find(filter)
      .populate("branchId", "branchCode name city")
      .populate("customerId", "customerCode name companyName")
      .populate("createdBy", "name employeeCode")
      .populate("agentAssignment.vendorId", "vendorCode name contactPerson mobile vehicles")
      .populate("shipmentId", "lrNumber currentStatus")
      .populate("pickupRunSheetId", "prsNumber status")
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean(),
    PickupRequest.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}

export async function listAgentLrs(query, user) {
  const options = listQuery(query);
  const filter = {
    ...branchFilter(user),
    shipmentId: { $exists: true },
    agentAssignment: { $exists: true },
  };
  if (query.status) filter.status = query.status;
  if (query.sourceType) filter["agentAssignment.sourceType"] = query.sourceType;
  if (query.search) {
    const pattern = { $regex: escapeSearch(query.search), $options: "i" };
    const shipments = await Shipment.find({ lrNumber: pattern }).select("_id").lean();
    filter.$or = [
      { pickupRequestNumber: pattern },
      { "shipper.companyName": pattern },
      { "recipient.companyName": pattern },
      { "agentAssignment.agentName": pattern },
      { "agentAssignment.vehicleNumber": pattern },
      { shipmentId: { $in: shipments.map((shipment) => shipment._id) } },
    ];
  }
  const [items, total] = await Promise.all([
    PickupRequest.find(filter)
      .populate("branchId", "branchCode name city")
      .populate("customerId", "customerCode name companyName")
      .populate("agentAssignment.vendorId", "vendorCode name mobile")
      .populate("shipmentId", "lrNumber currentStatus senderName receiverName packageCount weightKg createdAt")
      .populate("pickupRunSheetId", "prsNumber dispatchId status route vendorCategory vendorCode vendorName fieldExecutiveName fieldExecutiveMobile vehicleNumber vehicleType purEntries")
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean(),
    PickupRequest.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}

export async function getPickupRequest(id, user) {
  const record = await PickupRequest.findOne({ _id: id, ...branchFilter(user) })
    .populate("branchId", "branchCode name city")
    .populate("customerId", "customerCode customerType name companyName address pincode gstNumber creditRateCard creditCharges")
    .populate("createdBy", "name employeeCode")
    .populate("agentAssignment.vendorId", "vendorCode name contactPerson mobile vehicles")
    .populate("shipmentId", "lrNumber currentStatus")
    .populate("pickupRunSheetId", "prsNumber status");
  if (!record) throw new NotFoundError("Pickup request not found", "PICKUP_REQUEST_NOT_FOUND");
  return dto(record);
}

export async function assignPickupAgent(id, data, req) {
  const vendor = data.sourceType === "VENDOR"
    ? await Vendor.findOne({ _id: data.vendorId, status: ACTIVE.ACTIVE }).select(
        "vendorCode name contactPerson mobile vehicles",
      )
    : null;
  if (data.sourceType === "VENDOR" && !vendor)
    throw new ConflictError("Select an active vendor or pickup agent", "INVALID_PICKUP_AGENT");
  const session = await mongoose.startSession();
  try {
    let record;
    await session.withTransaction(async () => {
      record = await PickupRequest.findOne({ _id: id, ...branchFilter(req.user) }).session(session);
      if (!record) throw new NotFoundError("Pickup request not found", "PICKUP_REQUEST_NOT_FOUND");
      if (record.status !== "PENDING")
        throw new ConflictError("Agent can be assigned only to a pending pickup request", "PICKUP_REQUEST_NOT_PENDING");
      if (record.shipmentId)
        throw new ConflictError("Agent alignment cannot change after LR creation", "PICKUP_REQUEST_ALREADY_LINKED");
      const previous = record.agentAssignment?.toObject?.() ?? record.agentAssignment ?? null;
      record.agentAssignment = {
        ...data,
        assignedAt: new Date(),
        assignedBy: req.user._id,
      };
      await record.save({ session });
      await audit(session, req, "PICKUP_AGENT_ASSIGNED", "PickupRequest", record._id, previous, {
        sourceType: data.sourceType,
        vendorId: vendor?._id,
        vendorName: vendor?.name,
        vehicleNumber: data.vehicleNumber,
        driverName: data.driverName,
      });
    });
    await record.populate("agentAssignment.vendorId", "vendorCode name contactPerson mobile vehicles");
    return dto(record);
  } finally {
    await session.endSession();
  }
}

export async function pickupRequestSummary(user) {
  const rows = await PickupRequest.aggregate([
    { $match: branchFilter(user) },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const summary = { total: 0, pending: 0, dispatched: 0, cancelled: 0 };
  for (const row of rows) {
    const key = row._id?.toLowerCase();
    if (key in summary) summary[key] = row.count;
    summary.total += row.count;
  }
  return summary;
}

export async function updatePickupRequestStatus(id, data, req) {
  const record = await PickupRequest.findOne({ _id: id, ...branchFilter(req.user) });
  if (!record) throw new NotFoundError("Pickup request not found", "PICKUP_REQUEST_NOT_FOUND");
  if (record.status !== "PENDING")
    throw new ConflictError("Only pending pickup requests can be updated", "PICKUP_REQUEST_NOT_PENDING");
  if (record.pickupRunSheetId)
    throw new ConflictError("Pickup request is already assigned to a PRS", "PICKUP_REQUEST_ALREADY_ON_PRS");
  const previous = record.status;
  record.status = data.status;
  if (data.status === "DISPATCHED") {
    record.dispatchedAt = new Date();
    record.dispatchedBy = req.user._id;
  }
  await record.save();
  await audit(null, req, "PICKUP_REQUEST_STATUS_CHANGED", "PickupRequest", record._id, { status: previous }, {
    status: record.status,
  });
  return dto(record);
}
