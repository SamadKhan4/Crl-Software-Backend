import { sameLocation } from "../utils/locations.js";
import { hasCrossBranchAccess as hasFullOperationsAccess } from "../utils/access.js";
import mongoose from "mongoose";
import { ACTIVE, ROLES } from "../constants/workflow.js";
import { Notification, PickupRequest, PickupRunSheet, Shipment, User, Vendor } from "../models/index.js";
import { AuthorizationError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const alignedRoute = (pickup) => pickup?.agentAssignment?.route || [pickup?.shipper?.city, pickup?.recipient?.city].filter(Boolean).join(' - ');
const id = (value) => (value?._id ?? value)?.toString();
const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });
const branchFilter = (user) => hasFullOperationsAccess(user) ? {} : user.branchId ? { branchId: user.branchId } : { _id: null };
const assertSheetAccess = (sheet, user) => {
  if (!hasFullOperationsAccess(user) && id(sheet.branchId) !== id(user.branchId))
    throw new AuthorizationError("You can access PRS records only for your assigned branch");
};
const calculateVendorAmount = (sheet) => {
  if (sheet.rateSource === "MARKET") return Number(sheet.marketAmount || 0);
  if (sheet.rateBasis === "PER_KG") return Number(sheet.agreedRate || 0) * Number(sheet.totalWeightKg || 0);
  if (sheet.rateBasis === "PER_BOX") return Number(sheet.agreedRate || 0) * Number(sheet.totalBoxes || 0);
  return Number(sheet.agreedRate || 0);
};

export async function pickupRunSheetOptions(user) {
  const employeeFilter = { role: ROLES.EMPLOYEE, status: ACTIVE.ACTIVE };
  const [vendors, fieldExecutives, marketPickups, pickups] = await Promise.all([
    Vendor.find({ status: ACTIVE.ACTIVE }).select("vendorCode vendorType name contactPerson mobile commercial vehicles services").sort({ name: 1 }).lean(),
    User.find(employeeFilter).select("employeeCode name mobile branchId").populate("branchId", "branchCode name city").sort({ name: 1 }).lean(),
    PickupRequest.find({ ...branchFilter(user), status: "PENDING", pickupRunSheetId: null, "agentAssignment.sourceType": "MARKET" }).select("shipmentId agentAssignment").populate("shipmentId", "lrNumber").sort({ updatedAt: -1 }).lean(),
    PickupRequest.find({ ...branchFilter(user), status: "PENDING", pickupRunSheetId: null, shipmentId: { $ne: null } }).select("pickupRequestNumber branchId agentAssignment shipmentId shipper recipient totalBoxes totalWeightKg").populate({ path: "shipmentId", select: "lrNumber customerId senderName receiverName lrDetails packageCount weightKg", populate: { path: "customerId", select: "name companyName customerCode" } }).sort({ createdAt: -1 }).lean(),
  ]);
  return { vendors, fieldExecutives, pickups, marketVehicles: marketPickups.map((pickup) => ({ pickupRequestId: pickup._id, lrNumber: pickup.shipmentId?.lrNumber, ...pickup.agentAssignment })) };
}

export async function createPickupRunSheet(data, req) {
  const [vendor, fieldExecutive, marketPickup] = await Promise.all([
    data.vendorId ? Vendor.findOne({ _id: data.vendorId, status: ACTIVE.ACTIVE }) : null,
    User.findOne({ _id: data.fieldExecutiveId, role: ROLES.EMPLOYEE, status: ACTIVE.ACTIVE }),
    data.marketPickupRequestId ? PickupRequest.findOne({ _id: data.marketPickupRequestId, ...branchFilter(req.user), status: "PENDING", pickupRunSheetId: null, "agentAssignment.sourceType": "MARKET" }) : null,
  ]);
  if (data.marketPickupRequestId ? !marketPickup : !vendor) throw new ConflictError("Select an active vendor or available market vehicle", "INVALID_PRS_VENDOR");
  if (!fieldExecutive) throw new ConflictError("Select an active FE from Employee Master", "INVALID_FIELD_EXECUTIVE");
  if (!fieldExecutive.mobile) throw new ConflictError("Add the FE contact number in Employee Master", "FIELD_EXECUTIVE_MOBILE_REQUIRED");
  if (!hasFullOperationsAccess(req.user) && !req.user.branchId)
    throw new AuthorizationError("Assign an operations branch before creating PRS");
  const vehicle = marketPickup ? marketPickup.agentAssignment : vendor.vehicles.find((item) => item.vehicleNumber === data.vehicleNumber && item.status !== ACTIVE.INACTIVE);
  if (marketPickup && vehicle.vehicleNumber !== data.vehicleNumber)
    throw new ConflictError("Market vehicle details changed; select the vehicle again", "INVALID_VENDOR_VEHICLE");
  if (!vehicle) throw new ConflictError("Select a vehicle configured in Vendor Master", "INVALID_VENDOR_VEHICLE");
  const masterRate = Number(vendor?.commercial?.rate || 0);
  if (data.rateSource === "MASTER" && masterRate <= 0)
    throw new ConflictError("Configure the agreed vendor rate in Vendor Master", "VENDOR_RATE_NOT_CONFIGURED");

  const session = await mongoose.startSession();
  try {
    let sheet;
    await session.withTransaction(async () => {
      if (!data.pickups?.length) throw new ConflictError("Select at least one vendor LR", "PRS_PUR_REQUIRED");
      const firstPickup = await PickupRequest.findById(data.pickups[0].pickupRequestId).session(session);
      const route = alignedRoute(firstPickup) || data.route;
      if (!route) throw new ConflictError("Enter pickup and destination cities before creating PRS", "PRS_ROUTE_REQUIRED");
      const sheetBranch = hasFullOperationsAccess(req.user)
        ? firstPickup?.branchId || marketPickup?.branchId || req.user.branchId || fieldExecutive.branchId
        : req.user.branchId;
      if (!sheetBranch) throw new ConflictError("Assign an operations branch to create PRS", "PRS_BRANCH_REQUIRED");
      sheet = (
        await PickupRunSheet.create([{
          prsNumber: await generateBusinessNumber("pickup-run-sheet", "PRS", session),
          branchId: sheetBranch,
          vendorCategory: data.vendorCategory,
          rateSource: data.rateSource,
          vendorId: vendor?._id,
          marketPickupRequestId: marketPickup?._id,
          vendorCode: vendor?.vendorCode || "MARKET",
          vendorName: vendor?.name || vehicle.agentName,
          rateBasis: data.vendorCategory === "BP_KG" ? "PER_KG" : vendor?.commercial?.rateBasis || "PER_TRIP",
          agreedRate: data.rateSource === "MASTER" ? masterRate : data.marketAmount,
          ...(data.rateSource === "MARKET" && { marketAmount: data.marketAmount }),
          approvalStatus: data.rateSource === "MARKET" ? "PENDING" : "NOT_REQUIRED",
          fieldExecutiveId: fieldExecutive._id,
          fieldExecutiveName: fieldExecutive.name,
          fieldExecutiveMobile: fieldExecutive.mobile,
          vehicleNumber: vehicle.vehicleNumber,
          vehicleType: vehicle.vehicleType || data.vehicleType,
          driverName: vehicle.driverName,
          driverMobile: vehicle.driverMobile,
          pickupDate: data.pickupDate,
          route,
          status: data.rateSource === "MARKET" ? "PENDING_APPROVAL" : "DRAFT",
          remarks: data.remarks,
          createdBy: req.user._id,
        }], { session })
      )[0];
      if (!data.pickups?.length) throw new ConflictError("Select at least one vendor LR", "PRS_PUR_REQUIRED");
      for (const entry of data.pickups) {
        const pickup = await PickupRequest.findById(entry.pickupRequestId).session(session);
        const matchesVendor = marketPickup
          ? id(pickup?._id) === id(marketPickup._id)
          : pickup?.agentAssignment?.sourceType === "VENDOR" && id(pickup.agentAssignment.vendorId) === id(vendor._id);
        if (!matchesVendor) throw new ConflictError("Selected LR does not belong to this vendor", "PRS_VENDOR_MISMATCH");
        await attachPickup(sheet, entry, req, session);
      }
      await dispatchSheet(sheet, req, session);
      await audit(session, req, "PICKUP_RUN_SHEET_CREATED", "PickupRunSheet", sheet._id, null, {
        prsNumber: sheet.prsNumber,
        vendorCode: sheet.vendorCode,
        rateSource: sheet.rateSource,
        fieldExecutiveId: sheet.fieldExecutiveId,
      });
    });
    return dto(sheet);
  } finally {
    await session.endSession();
  }
}

async function attachPickup(sheet, data, req, session) {
  if (!["DRAFT", "READY", "PENDING_APPROVAL"].includes(sheet.status))
    throw new ConflictError("PUR cannot be added after PRS dispatch", "PRS_ALREADY_DISPATCHED");
  if (sheet.pickupRequestIds.some((value) => id(value) === data.pickupRequestId))
    throw new ConflictError("PUR is already added to this sheet", "PUR_ALREADY_ADDED");
  const pickup = await PickupRequest.findById(data.pickupRequestId).session(session);
  if (!pickup) throw new NotFoundError("Pickup request not found", "PICKUP_REQUEST_NOT_FOUND");
  if (!pickup.branchId && hasFullOperationsAccess(req.user) && id(sheet.marketPickupRequestId) === id(pickup._id))
    pickup.branchId = sheet.branchId;
  if (!hasFullOperationsAccess(req.user) && id(pickup.branchId) !== id(req.user.branchId))
    throw new AuthorizationError("You can assign LRs only from your operations branch");
  if (pickup.status !== "PENDING" || pickup.pickupRunSheetId)
    throw new ConflictError("PUR is already dispatched or assigned to another sheet", "PICKUP_REQUEST_NOT_ELIGIBLE");
  const route = alignedRoute(pickup);
  if (route && !sameLocation(route, sheet.route)) throw new ConflictError("Select LRs aligned to the same route for one PRS", "PRS_ROUTE_MISMATCH");
  if (!pickup.shipmentId) throw new ConflictError("Create LR before adding the PUR to PRS", "PICKUP_LR_REQUIRED");

  const shipment = await Shipment.findById(pickup.shipmentId).populate("customerId", "name companyName").session(session);
  if (!shipment || shipment.currentStatus === "CANCELLED") throw new ConflictError("LR is unavailable for PRS", "PICKUP_LR_REQUIRED");
  const paymentTerm = shipment.lrDetails?.paymentMode || data.paymentTerm || "CREDIT";
  const amount = shipment.lrDetails?.totalAmount ?? data.amount ?? 0;
  sheet.pickupRequestIds.push(pickup._id);
  sheet.shipmentIds.push(pickup.shipmentId);
  sheet.purEntries.push({ pickupRequestId: pickup._id, shipmentId: pickup.shipmentId, lrNumber: shipment.lrNumber, weightKg: shipment.weightKg, packageCount: shipment.packageCount, clientName: shipment.customerId?.companyName || shipment.customerId?.name || shipment.senderName, destination: shipment.lrDetails?.to || pickup.recipient?.city, paymentTerm, amount, addedBy: req.user._id });
  sheet.totalBoxes += Number(shipment.packageCount || 0);
  sheet.totalWeightKg += Number(shipment.weightKg || 0);
  sheet.vendorPayableAmount = calculateVendorAmount(sheet);
  sheet.status = sheet.approvalStatus === "PENDING" ? "PENDING_APPROVAL" : "READY";
  await sheet.save({ session });

  pickup.pickupRunSheetId = sheet._id;
  pickup.agentAssignment = {
    route: pickup.agentAssignment?.route || sheet.route,
    sourceType: sheet.marketPickupRequestId ? "MARKET" : "VENDOR",
    vendorId: sheet.vendorId,
    agentName: sheet.marketPickupRequestId ? sheet.vendorName : sheet.fieldExecutiveName,
    vehicleNumber: sheet.vehicleNumber,
    vehicleType: sheet.vehicleType,
    driverName: sheet.driverName || sheet.fieldExecutiveName,
    driverMobile: sheet.driverMobile || sheet.fieldExecutiveMobile,
    remarks: `Aligned through ${sheet.prsNumber}`,
    assignedAt: new Date(),
    assignedBy: req.user._id,
  };
  await pickup.save({ session });
  await audit(session, req, "PICKUP_ADDED_TO_PRS", "PickupRunSheet", sheet._id, null, {
    prsNumber: sheet.prsNumber,
    pickupRequestNumber: pickup.pickupRequestNumber,
    paymentTerm,
    amount,
  });
}

export async function addPickupToRunSheet(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let sheet;
    await session.withTransaction(async () => {
      sheet = await PickupRunSheet.findById(recordId).session(session);
      if (!sheet) throw new NotFoundError("Pickup run sheet not found", "PICKUP_RUN_SHEET_NOT_FOUND");
      assertSheetAccess(sheet, req.user);
      await attachPickup(sheet, data, req, session);
    });
    return dto(sheet);
  } finally {
    await session.endSession();
  }
}

export async function reviewMarketRate(recordId, data, req) {
  const sheet = await PickupRunSheet.findById(recordId);
  if (!sheet) throw new NotFoundError("Pickup run sheet not found", "PICKUP_RUN_SHEET_NOT_FOUND");
  assertSheetAccess(sheet, req.user);
  if (sheet.rateSource !== "MARKET" || sheet.approvalStatus !== "PENDING")
    throw new ConflictError("This PRS has no pending market-rate approval", "PRS_APPROVAL_NOT_PENDING");
  sheet.approvalStatus = data.decision;
  sheet.approvalRemarks = data.remarks;
  sheet.approvedAt = new Date();
  sheet.approvedBy = req.user._id;
  if (sheet.status !== "DISPATCHED") sheet.status = data.decision === "APPROVED" ? (sheet.pickupRequestIds.length ? "READY" : "DRAFT") : "PENDING_APPROVAL";
  await sheet.save();
  await audit(null, req, `PRS_MARKET_RATE_${data.decision}`, "PickupRunSheet", sheet._id, null, {
    prsNumber: sheet.prsNumber,
    marketAmount: sheet.marketAmount,
    remarks: data.remarks,
  });
  return dto(sheet);
}

// Operational dispatch is independent of the vendor market-rate review.
async function dispatchSheet(sheet, req, session) {
      sheet.dispatchId = await generateBusinessNumber("pickup-dispatch", "DSP", session);
      sheet.dispatchedAt = new Date();
      sheet.dispatchedBy = req.user._id;
      sheet.status = "DISPATCHED";
      sheet.vendorPayableAmount = calculateVendorAmount(sheet);
      await sheet.save({ session });
      const pickups = await PickupRequest.find({ _id: { $in: sheet.pickupRequestIds } }).session(session);
      if (
        pickups.length !== sheet.pickupRequestIds.length ||
        pickups.some((pickup) => pickup.status !== "PENDING" || id(pickup.pickupRunSheetId) !== id(sheet._id))
      )
        throw new ConflictError("One or more PURs are no longer available for dispatch", "PRS_PUR_NOT_ELIGIBLE");
      for (const pickup of pickups) {
        pickup.status = "DISPATCHED";
        pickup.dispatchedAt = sheet.dispatchedAt;
        pickup.dispatchedBy = req.user._id;
        await pickup.save({ session });
        await Notification.create([{
          event: "PICKUP_DISPATCHED",
          pickupRequestId: pickup._id,
          customerId: pickup.customerId,
          branchId: sheet.branchId,
          recipientName: pickup.shipper?.contactName,
          mobile: pickup.shipper?.contactMobile,
          channels: ["WHATSAPP", "SMS"],
          subject: "Pickup vehicle dispatched",
          message: `${sheet.dispatchId}: ${sheet.fieldExecutiveName} (${sheet.fieldExecutiveMobile}) has been dispatched for LR ${sheet.purEntries.find((entry) => id(entry.pickupRequestId) === id(pickup))?.lrNumber || ""}. Vehicle: ${sheet.vehicleNumber}.`,
        }], { session });
      }
      await audit(session, req, "PICKUP_RUN_SHEET_DISPATCHED", "PickupRunSheet", sheet._id, null, {
        prsNumber: sheet.prsNumber,
        dispatchId: sheet.dispatchId,
        pickupCount: sheet.pickupRequestIds.length,
        vendorPayableAmount: sheet.vendorPayableAmount,
      });
}

export async function dispatchPickupRunSheet(recordId, req) {
  const session = await mongoose.startSession();
  try {
    let sheet;
    await session.withTransaction(async () => {
      sheet = await PickupRunSheet.findById(recordId).session(session);
      if (!sheet) throw new NotFoundError("Pickup run sheet not found", "PICKUP_RUN_SHEET_NOT_FOUND");
      assertSheetAccess(sheet, req.user);
      if (sheet.status === "DISPATCHED") throw new ConflictError("PRS is already dispatched", "PRS_ALREADY_DISPATCHED");
      if (!sheet.pickupRequestIds.length) throw new ConflictError("Add at least one PUR before dispatch", "PRS_PUR_REQUIRED");
      if (["PENDING", "REJECTED"].includes(sheet.approvalStatus))
        throw new ConflictError("Manager approval is required for the market amount", "PRS_MARKET_APPROVAL_REQUIRED");

      await dispatchSheet(sheet, req, session);
    });
    return dto(sheet);
  } finally {
    await session.endSession();
  }
}

export async function listPickupRunSheets(query, user) {
  const options = listQuery(query);
  const filter = branchFilter(user);
  if (query.status) filter.status = query.status;
  if (query.search)
    filter.$or = ["prsNumber", "dispatchId", "vendorName", "vehicleNumber", "fieldExecutiveName", "route"].map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([
    PickupRunSheet.find(filter).populate("branchId", "branchCode name city").populate("createdBy", "name employeeCode").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    PickupRunSheet.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}

export async function getPickupRunSheet(recordId, user) {
  const record = await PickupRunSheet.findOne({ _id: recordId, ...branchFilter(user) })
    .populate("branchId", "branchCode name city address")
    .populate("vendorId", "vendorCode name contactPerson mobile commercial vehicles")
    .populate("fieldExecutiveId", "employeeCode name mobile")
    .populate("createdBy approvedBy dispatchedBy", "name employeeCode")
    .populate({ path: "pickupRequestIds", populate: [
      { path: "shipmentId", select: "lrNumber senderName receiverName packageCount weightKg currentStatus lrDetails" },
      { path: "customerId", select: "customerCode name companyName" },
    ] });
  if (!record) throw new NotFoundError("Pickup run sheet not found", "PICKUP_RUN_SHEET_NOT_FOUND");
  return dto(record);
}
