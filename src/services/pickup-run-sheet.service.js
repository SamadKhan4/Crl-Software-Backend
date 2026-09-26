import mongoose from "mongoose";
import { ACTIVE, ROLES } from "../constants/workflow.js";
import { Notification, PickupRequest, PickupRunSheet, User, Vendor } from "../models/index.js";
import { AuthorizationError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const id = (value) => (value?._id ?? value)?.toString();
const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });
const branchFilter = (user) => user.role === ROLES.ADMIN ? {} : user.branchId ? { branchId: user.branchId } : { _id: null };
const assertSheetAccess = (sheet, user) => {
  if (user.role !== ROLES.ADMIN && id(sheet.branchId) !== id(user.branchId))
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
  if (user.role !== ROLES.ADMIN) employeeFilter.branchId = user.branchId;
  const [vendors, fieldExecutives] = await Promise.all([
    Vendor.find({ status: ACTIVE.ACTIVE }).select("vendorCode vendorType name contactPerson mobile commercial vehicles services").sort({ name: 1 }).lean(),
    User.find(employeeFilter).select("employeeCode name mobile branchId").populate("branchId", "branchCode name city").sort({ name: 1 }).lean(),
  ]);
  return { vendors, fieldExecutives };
}

export async function createPickupRunSheet(data, req) {
  const [vendor, fieldExecutive] = await Promise.all([
    Vendor.findOne({ _id: data.vendorId, status: ACTIVE.ACTIVE }),
    User.findOne({ _id: data.fieldExecutiveId, role: ROLES.EMPLOYEE, status: ACTIVE.ACTIVE }),
  ]);
  if (!vendor) throw new ConflictError("Select an active vendor from Vendor Master", "INVALID_PRS_VENDOR");
  if (!fieldExecutive) throw new ConflictError("Select an active FE from Employee Master", "INVALID_FIELD_EXECUTIVE");
  if (!fieldExecutive.mobile) throw new ConflictError("Add the FE contact number in Employee Master", "FIELD_EXECUTIVE_MOBILE_REQUIRED");
  if (!fieldExecutive.branchId) throw new ConflictError("Assign a branch to the selected FE", "FIELD_EXECUTIVE_BRANCH_REQUIRED");
  if (req.user.role !== ROLES.ADMIN && id(fieldExecutive.branchId) !== id(req.user.branchId))
    throw new AuthorizationError("Select a field executive from your assigned branch");
  const vehicle = vendor.vehicles.find((item) => item.vehicleNumber === data.vehicleNumber);
  if (!vehicle) throw new ConflictError("Select a vehicle configured in Vendor Master", "INVALID_VENDOR_VEHICLE");
  const masterRate = Number(vendor.commercial?.rate || 0);
  if (data.rateSource === "MASTER" && masterRate <= 0)
    throw new ConflictError("Configure the agreed vendor rate in Vendor Master", "VENDOR_RATE_NOT_CONFIGURED");

  const session = await mongoose.startSession();
  try {
    let sheet;
    await session.withTransaction(async () => {
      sheet = (
        await PickupRunSheet.create([{
          prsNumber: await generateBusinessNumber("pickup-run-sheet", "PRS", session),
          branchId: fieldExecutive.branchId,
          vendorCategory: data.vendorCategory,
          rateSource: data.rateSource,
          vendorId: vendor._id,
          vendorCode: vendor.vendorCode,
          vendorName: vendor.name,
          rateBasis: data.vendorCategory === "BP_KG" ? "PER_KG" : vendor.commercial?.rateBasis || "PER_TRIP",
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
          route: data.route,
          status: data.rateSource === "MARKET" ? "PENDING_APPROVAL" : "DRAFT",
          remarks: data.remarks,
          createdBy: req.user._id,
        }], { session })
      )[0];
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

export async function addPickupToRunSheet(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let sheet;
    await session.withTransaction(async () => {
      sheet = await PickupRunSheet.findById(recordId).session(session);
      if (!sheet) throw new NotFoundError("Pickup run sheet not found", "PICKUP_RUN_SHEET_NOT_FOUND");
      assertSheetAccess(sheet, req.user);
      if (!["DRAFT", "READY", "PENDING_APPROVAL"].includes(sheet.status))
        throw new ConflictError("PUR cannot be added after PRS dispatch", "PRS_ALREADY_DISPATCHED");
      if (sheet.pickupRequestIds.some((value) => id(value) === data.pickupRequestId))
        throw new ConflictError("PUR is already added to this sheet", "PUR_ALREADY_ADDED");
      const pickup = await PickupRequest.findById(data.pickupRequestId).session(session);
      if (!pickup) throw new NotFoundError("Pickup request not found", "PICKUP_REQUEST_NOT_FOUND");
      if (id(pickup.branchId) !== id(sheet.branchId))
        throw new ConflictError("PUR and PRS must belong to the same branch", "PRS_BRANCH_MISMATCH");
      if (pickup.status !== "PENDING" || pickup.pickupRunSheetId)
        throw new ConflictError("PUR is already dispatched or assigned to another sheet", "PICKUP_REQUEST_NOT_ELIGIBLE");
      if (!pickup.shipmentId) throw new ConflictError("Create LR before adding the PUR to PRS", "PICKUP_LR_REQUIRED");

      sheet.pickupRequestIds.push(pickup._id);
      sheet.shipmentIds.push(pickup.shipmentId);
      sheet.purEntries.push({ pickupRequestId: pickup._id, shipmentId: pickup.shipmentId, paymentTerm: data.paymentTerm, amount: data.amount, addedBy: req.user._id });
      sheet.totalBoxes += pickup.totalBoxes;
      sheet.totalWeightKg += pickup.totalWeightKg;
      sheet.vendorPayableAmount = calculateVendorAmount(sheet);
      sheet.status = sheet.approvalStatus === "PENDING" ? "PENDING_APPROVAL" : "READY";
      await sheet.save({ session });

      pickup.pickupRunSheetId = sheet._id;
      pickup.agentAssignment = {
        sourceType: "VENDOR",
        vendorId: sheet.vendorId,
        agentName: sheet.fieldExecutiveName,
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
        paymentTerm: data.paymentTerm,
        amount: data.amount,
      });
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
  sheet.status = data.decision === "APPROVED" ? (sheet.pickupRequestIds.length ? "READY" : "DRAFT") : "PENDING_APPROVAL";
  await sheet.save();
  await audit(null, req, `PRS_MARKET_RATE_${data.decision}`, "PickupRunSheet", sheet._id, null, {
    prsNumber: sheet.prsNumber,
    marketAmount: sheet.marketAmount,
    remarks: data.remarks,
  });
  return dto(sheet);
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
          recipientName: pickup.shipper.contactName,
          mobile: pickup.shipper.contactMobile,
          channels: ["WHATSAPP", "SMS"],
          subject: "Pickup vehicle dispatched",
          message: `${sheet.dispatchId}: ${sheet.fieldExecutiveName} (${sheet.fieldExecutiveMobile}) has been dispatched for pickup request ${pickup.pickupRequestNumber}. Vehicle: ${sheet.vehicleNumber}.`,
        }], { session });
      }
      await audit(session, req, "PICKUP_RUN_SHEET_DISPATCHED", "PickupRunSheet", sheet._id, null, {
        prsNumber: sheet.prsNumber,
        dispatchId: sheet.dispatchId,
        pickupCount: sheet.pickupRequestIds.length,
        vendorPayableAmount: sheet.vendorPayableAmount,
      });
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
