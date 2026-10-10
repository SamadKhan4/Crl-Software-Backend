import { operationsOffice } from "./operations-office.service.js";
import { hasCrossBranchAccess as hasFullOperationsAccess } from "../utils/access.js";
import mongoose from "mongoose";
import { LAST_MILE_STATE, MIDDLE_MILE_STATE, SHIPMENT_STATUS, TRACKING_EVENT_STATUS } from "../constants/workflow.js";
import { DeliveryRunSheet, Manifest, MovementLeg, PackageUnit, PickupRunSheet, Shipment, ShipmentEvent, Trip, UnloadingTally, User, Vendor } from "../models/index.js";
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const id = (value) => (value?._id ?? value)?.toString();
const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });
const isAdmin = hasFullOperationsAccess;
const branchFor = (requested, user) => {
  const branchId = isAdmin(user) ? requested : user.branchId;
  if (!branchId) throw new BusinessRuleError("Select an operating branch", "BRANCH_REQUIRED");
  if (!isAdmin(user) && requested && id(requested) !== id(user.branchId)) throw new AuthorizationError("You can operate only your assigned branch");
  return branchId;
};
const assertBranch = (record, user) => {
  if (!isAdmin(user) && id(record.branchId) !== id(user.branchId)) throw new AuthorizationError("You can operate only your assigned branch");
};
const eventRows = (shipments, status, branchId, user, remarks, refs = {}) => shipments.map((shipment) => ({
  shipmentId: shipment._id, status, location: shipment.currentLocation || "Destination hub", branchId,
  remarks, updatedBy: user._id, ...refs,
}));

async function prsVendorId(shipmentIds, session = null) {
  let query = PickupRunSheet.find({ shipmentIds: { $in: shipmentIds.map((value) => value?._id ?? value) }, status: "DISPATCHED", vendorId: { $ne: null } }).select("vendorId");
  if (session) query = query.session(session);
  const vendorIds = [...new Set((await query.lean()).map((sheet) => id(sheet.vendorId)).filter(Boolean))];
  return vendorIds.length === 1 ? vendorIds[0] : null;
}

export async function listArrivals(query, user) {
  const options = listQuery(query);
  const filter = { tripType: "MIDDLE_MILE", status: "ARRIVED", ...(isAdmin(user) ? (query.branchId ? { toHubId: query.branchId } : {}) : { toHubId: user.branchId }) };
  const startedTripIds = await UnloadingTally.distinct("tripId", { status: { $ne: "CANCELLED" } });
  if (startedTripIds.length) filter._id = { $nin: startedTripIds };
  if (query.search) filter.$or = ["tripNumber", "vehicleNumber", "driverName"].map((key) => ({ [key]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([
    Trip.find(filter).populate("fromHubId toHubId shipmentIds").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    Trip.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}

export async function createUnloadingTally(data, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      const trip = await Trip.findOne({ _id: data.tripId, tripType: "MIDDLE_MILE", status: "ARRIVED" }).session(session);
      if (!trip) throw new NotFoundError("Arrived trip not found", "ARRIVED_TRIP_NOT_FOUND");
      const branchId = branchFor(data.branchId || trip.toHubId, req.user);
      if (await UnloadingTally.exists({ tripId: trip._id }).session(session)) throw new ConflictError("Unloading tally already exists for this trip", "UNLOADING_TALLY_EXISTS");
      const shipments = await Shipment.find({ _id: { $in: trip.shipmentIds }, lastMileState: LAST_MILE_STATE.ARRIVED }).session(session);
      if (!shipments.length) throw new BusinessRuleError("Trip has no final-destination LR for Last Mile", "NO_LAST_MILE_SHIPMENTS");
      tally = (await UnloadingTally.create([{
        tallyNumber: await generateBusinessNumber("unloading-tally", "UT", session), tripId: trip._id, branchId,
        shipmentIds: shipments.map((row) => row._id),
        items: shipments.map((row) => ({ shipmentId: row._id, expectedPackages: row.packageCount })),
        unloadingBay: data.unloadingBay, totalLrs: shipments.length,
        totalPackages: shipments.reduce((sum, row) => sum + row.packageCount, 0), remarks: data.remarks, createdBy: req.user._id,
      }], { session }))[0];
      await Shipment.updateMany({ _id: { $in: tally.shipmentIds } }, { $set: { lastMileState: LAST_MILE_STATE.UNLOADING, unloadingTallyId: tally._id } }, { session });
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.UNLOADING, branchId, req.user, `Unloading started under ${tally.tallyNumber}`, { tripId: trip._id, unloadingTallyId: tally._id }), { session, ordered: true });
      await audit(session, req, "LAST_MILE_UNLOADING_CREATED", "UnloadingTally", tally._id, null, { number: tally.tallyNumber, tripId: trip._id, shipmentCount: shipments.length });
    });
    return dto(tally);
  } finally { await session.endSession(); }
}

export async function listUnloadingTallies(query, user) {
  const options = listQuery(query); const filter = isAdmin(user) ? (query.branchId ? { branchId: query.branchId } : {}) : { branchId: user.branchId };
  if (query.status) filter.status = query.status;
  if (query.search) filter.tallyNumber = { $regex: escapeSearch(query.search), $options: "i" };
  const [items, total] = await Promise.all([
    UnloadingTally.find(filter).populate("tripId branchId items.shipmentId").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    UnloadingTally.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}
export async function getUnloadingTally(recordId, user) {
  const tally = await UnloadingTally.findById(recordId).populate({ path: "tripId", populate: { path: "manifestIds", populate: { path: "shipmentIds", select: "lrNumber packageCount" } } }).populate("branchId items.shipmentId");
  if (!tally) throw new NotFoundError("Unloading tally not found", "UNLOADING_TALLY_NOT_FOUND");
  assertBranch(tally, user); return dto(tally);
}

export async function scanUnloadingTally(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      tally = await UnloadingTally.findById(recordId).session(session);
      if (!tally) throw new NotFoundError("Unloading tally not found", "UNLOADING_TALLY_NOT_FOUND");
      assertBranch(tally, req.user);
      if (tally.status !== "UNLOADING") throw new ConflictError("Unloading tally is not open for scanning", "UNLOADING_NOT_OPEN");
      const barcode = data.barcode.toUpperCase();
      if (tally.items.some((item) => item.scannedBarcodes.includes(barcode))) throw new ConflictError("Package already scanned", "PACKAGE_ALREADY_SCANNED");
      const pack = await PackageUnit.findOne({ barcode }).session(session);
      if (!pack || !tally.shipmentIds.some((shipmentId) => id(shipmentId) === id(pack.shipmentId))) throw new BusinessRuleError("Package does not belong to this arrived trip", "WRONG_TRIP_PACKAGE");
      const item = tally.items.find((row) => id(row.shipmentId) === id(pack.shipmentId));
      item.scannedBarcodes.push(barcode); item.receivedPackages = item.scannedBarcodes.length;
      tally.scannedPackages += 1; await tally.save({ session });
      pack.status = "UNLOADED"; pack.currentLocation = "Destination hub"; pack.currentCustodianType = "BRANCH"; pack.currentCustodianId = id(tally.branchId);
      pack.scans.push({ action: "UNLOADED", location: "Destination hub", branchId: tally.branchId, remarks: tally.tallyNumber, scannedBy: req.user._id });
      await pack.save({ session });
    });
    return dto(tally);
  } finally { await session.endSession(); }
}

export async function completeUnloadingTally(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      tally = await UnloadingTally.findById(recordId).session(session);
      if (!tally) throw new NotFoundError("Unloading tally not found", "UNLOADING_TALLY_NOT_FOUND");
      assertBranch(tally, req.user); if (tally.status !== "UNLOADING") throw new ConflictError("Unloading tally is not open", "UNLOADING_NOT_OPEN");
      const exceptions = new Map((data.exceptions || []).map((row) => [id(row.shipmentId), row]));
      if ([...exceptions.keys()].some((shipmentId) => !tally.items.some((item) => id(item.shipmentId) === shipmentId))) throw new BusinessRuleError("LR does not belong to this trip", "TALLY_SHIPMENT_NOT_FOUND");
      for (const item of tally.items) {
        const exception = exceptions.get(id(item.shipmentId));
        if (exception?.receivedPackages !== undefined) {
          if (exception.receivedPackages < item.scannedBarcodes.length) throw new BusinessRuleError("Received boxes cannot be fewer than scanned packages", "RECEIVED_BELOW_SCANNED");
          if (!exception.receiptRemarks?.trim()) throw new BusinessRuleError("Enter remarks for every verified LR", "LR_REMARKS_REQUIRED");
          item.receivedPackages = exception.receivedPackages;
          item.receiptRemarks = exception.receiptRemarks.trim();
        }
        item.shortPackages = Math.max(0, item.expectedPackages - item.receivedPackages);
        item.excessPackages = exception?.receivedPackages !== undefined ? Math.max(0, item.receivedPackages - item.expectedPackages) : Number(exception?.excessPackages || 0);
        item.damagedPackages = Number(exception?.damagedPackages || 0);
        if (item.damagedPackages > item.receivedPackages) throw new BusinessRuleError("Damaged boxes cannot exceed received boxes", "DAMAGE_EXCEEDS_RECEIVED");
        if ((item.shortPackages || item.excessPackages || item.damagedPackages) && !exception?.depsCode && exception?.receivedPackages === undefined)
          throw new BusinessRuleError("DEPS code is required for unloading discrepancy", "DEPS_CODE_REQUIRED");
        if ((item.shortPackages || item.excessPackages || item.damagedPackages) && !(exception?.depsRemarks || exception?.receiptRemarks)?.trim()) throw new BusinessRuleError("Remarks are required for short, extra or damaged boxes", "EXCEPTION_REMARKS_REQUIRED");
        item.depsCode = exception?.depsCode; item.depsRemarks = exception?.depsRemarks || (item.shortPackages || item.excessPackages || item.damagedPackages ? exception?.receiptRemarks : undefined);
      }
      const trip = await Trip.findById(tally.tripId).session(session);
      if (!trip || trip.status !== "ARRIVED") throw new ConflictError("Trip is not ready for closure", "TRIP_NOT_ARRIVED");
      if (trip.shipmentIds.length !== tally.shipmentIds.length) throw new ConflictError("Trip contains onward LRs; complete the hub transfer before closing it", "ONWARD_LRS_PENDING");
      const manifests = await Manifest.find({ _id: { $in: trip.manifestIds }, tripId: trip._id }).session(session);
      if (manifests.length !== trip.manifestIds.length || manifests.some((manifest) => manifest.shipmentIds.some((shipmentId) => !tally.shipmentIds.some((value) => id(value) === id(shipmentId))))) throw new ConflictError("Trip manifests do not match the received LRs", "TRIP_MANIFEST_MISMATCH");
      tally.status = "QC_PENDING"; tally.completedAt = new Date(); tally.completedBy = req.user._id; await tally.save({ session });
      trip.status = "CLOSED"; trip.workflowStatus = "CLOSED"; await trip.save({ session });
      await Manifest.updateMany({ _id: { $in: trip.manifestIds } }, { $set: { status: "CLOSED" } }, { session });
      const shipments = await Shipment.find({ _id: { $in: tally.shipmentIds } }).session(session);
      await Shipment.updateMany({ _id: { $in: tally.shipmentIds } }, { $set: { lastMileState: LAST_MILE_STATE.QC_PENDING } }, { session });
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.UNLOADING_COMPLETED, tally.branchId, req.user, `Unloading completed under ${tally.tallyNumber}`, { unloadingTallyId: tally._id, tripId: tally.tripId }), { session, ordered: true });
      await audit(session, req, "LAST_MILE_UNLOADING_COMPLETED", "UnloadingTally", tally._id, { status: "UNLOADING" }, { status: tally.status, scannedPackages: tally.scannedPackages });
      await audit(session, req, "LAST_MILE_TRIP_CLOSED", "Trip", trip._id, { status: "ARRIVED" }, { status: "CLOSED", tallyNumber: tally.tallyNumber });
    }); return dto(tally);
  } finally { await session.endSession(); }
}

export async function updateQc(recordId, shipmentId, data, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      tally = await UnloadingTally.findById(recordId).session(session);
      if (!tally) throw new NotFoundError("Unloading tally not found", "UNLOADING_TALLY_NOT_FOUND"); assertBranch(tally, req.user);
      if (!["QC_PENDING", "READY_FOR_INWARD"].includes(tally.status)) throw new ConflictError("Tally is not pending QC", "QC_NOT_OPEN");
      const item = tally.items.find((row) => id(row.shipmentId) === shipmentId);
      if (!item) throw new NotFoundError("LR is not in this tally", "TALLY_SHIPMENT_NOT_FOUND");
      item.qcStatus = data.qcStatus; item.depsCode = data.depsCode; item.depsRemarks = data.depsRemarks; item.storageLocation = data.storageLocation; item.checkedAt = new Date(); item.checkedBy = req.user._id;
      tally.status = tally.items.every((row) => row.qcStatus === "PASSED") ? "READY_FOR_INWARD" : "QC_PENDING"; await tally.save({ session });
      const shipment = await Shipment.findById(shipmentId).session(session);
      shipment.lastMileState = data.qcStatus === "PASSED" ? LAST_MILE_STATE.QC_PASSED : LAST_MILE_STATE.QC_HOLD; shipment.storageLocation = data.storageLocation; await shipment.save({ session });
      await ShipmentEvent.create(eventRows([shipment], data.qcStatus === "PASSED" ? TRACKING_EVENT_STATUS.QC_PASSED : TRACKING_EVENT_STATUS.QC_HOLD, tally.branchId, req.user, data.depsRemarks || `QC ${data.qcStatus}`, { unloadingTallyId: tally._id, tripId: tally.tripId }), { session });
      await audit(session, req, "LAST_MILE_QC_UPDATED", "UnloadingTally", tally._id, null, { shipmentId, qcStatus: data.qcStatus, depsCode: data.depsCode });
    }); return dto(tally);
  } finally { await session.endSession(); }
}

export async function destinationInward(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      tally = await UnloadingTally.findById(recordId).session(session);
      if (!tally) throw new NotFoundError("Unloading tally not found", "UNLOADING_TALLY_NOT_FOUND"); assertBranch(tally, req.user);
      if (tally.status !== "READY_FOR_INWARD" || tally.items.some((row) => row.qcStatus !== "PASSED")) throw new ConflictError("Every LR must pass QC before destination inward", "QC_INCOMPLETE");
      const [trip, shipments] = await Promise.all([Trip.findById(tally.tripId).session(session), Shipment.find({ _id: { $in: tally.shipmentIds } }).session(session)]);
      const destination = trip?.destination || shipments[0]?.currentLocation;
      if (!destination) throw new ConflictError("Trip destination is missing", "DESTINATION_REQUIRED");
      const now = new Date();
      for (const shipment of shipments) {
        shipment.currentStatus = SHIPMENT_STATUS.RECEIVED; shipment.currentHubId = tally.branchId; shipment.receivingBranchId = tally.branchId;
        shipment.currentLocation = destination; shipment.movementState = MIDDLE_MILE_STATE.LAST_MILE_READY;
        shipment.lastMileState = LAST_MILE_STATE.DESTINATION_INWARDED; shipment.receivedAt = now; shipment.receivedBy = req.user._id;
        shipment.destinationInwardAt = now; shipment.destinationInwardBy = req.user._id; await shipment.save({ session });
      }
      await PackageUnit.updateMany({ shipmentId: { $in: tally.shipmentIds } }, { $set: { status: "HUB_INWARD", currentLocation: destination, currentCustodianType: "BRANCH", currentCustodianId: id(tally.branchId) } }, { session });
      tally.status = "INWARDED"; tally.inwardedAt = now; tally.inwardedBy = req.user._id; tally.remarks = data.remarks || tally.remarks; await tally.save({ session });
      await Trip.updateOne({ _id: tally.tripId }, { $set: { status: "CLOSED", workflowStatus: "CLOSED" } }, { session });
      await MovementLeg.updateMany({ tripId: tally.tripId, shipmentId: { $in: tally.shipmentIds } }, { $set: { status: MIDDLE_MILE_STATE.LAST_MILE_READY, completedAt: now } }, { session });
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.LAST_MILE_READY, tally.branchId, req.user, data.remarks || `Destination inward under ${tally.tallyNumber}`, { unloadingTallyId: tally._id, tripId: tally.tripId }), { session, ordered: true });
      await audit(session, req, "LAST_MILE_DESTINATION_INWARD", "UnloadingTally", tally._id, { status: "READY_FOR_INWARD" }, { status: "INWARDED", shipmentCount: shipments.length });
    }); return dto(tally);
  } finally { await session.endSession(); }
}

export async function drsInventory(query, _user) {
  const options = listQuery(query);
  const filter = { lastMileState: LAST_MILE_STATE.DESTINATION_INWARDED, activeDrsId: { $exists: false }, currentStatus: SHIPMENT_STATUS.RECEIVED };
  if (query.search) filter.$or = ["lrNumber", "receiverName", "receiverMobile"].map((key) => ({ [key]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([Shipment.find(filter).sort(options.sort).skip(options.skip).limit(options.limit).lean(), Shipment.countDocuments(filter)]);
  return paginated(items.map(dto), total, options);
}

export async function drsManifests(query, _user) {
  const options = listQuery(query);
  const inventoryFilter = { lastMileState: LAST_MILE_STATE.DESTINATION_INWARDED, activeDrsId: { $exists: false }, currentStatus: SHIPMENT_STATUS.RECEIVED };
  const eligibleIds = await Shipment.distinct("_id", inventoryFilter);
  if (!eligibleIds.length) return paginated([], 0, options);
  const filter = { shipmentIds: { $in: eligibleIds }, status: { $ne: "CANCELLED" } };
  if (query.search) filter.$or = ["manifestNumber", "origin", "destination", "vehicleNumber"].map((key) => ({ [key]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [manifests, total] = await Promise.all([
    Manifest.find(filter)
      .populate("branchId vendorId routeId shipmentIds")
      .populate({ path: "tripId", populate: { path: "vendorId" } })
      .sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    Manifest.countDocuments(filter),
  ]);
  const eligible = new Set(eligibleIds.map(id));
  const items = await Promise.all(manifests.map(async (manifest) => {
    const sourceVendorId = !manifest.vendorId ? await prsVendorId(manifest.shipmentIds) : null;
    const sourceVendor = sourceVendorId ? await Vendor.findById(sourceVendorId).select("vendorCode name").lean() : null;
    return dto({
      ...manifest,
      vendorId: manifest.vendorId || sourceVendor || manifest.tripId?.vendorId,
      shipmentIds: manifest.shipmentIds.filter((shipment) => eligible.has(id(shipment))),
    });
  }));
  return paginated(items, total, options);
}

export async function createDrs(data, req) {
  const branchId = (await operationsOffice())._id; const session = await mongoose.startSession();
  try {
    let drs;
    await session.withTransaction(async () => {
      const manifest = await Manifest.findById(data.manifestId).session(session);
      if (!manifest || manifest.status === "CANCELLED") throw new NotFoundError("Delivery manifest not found", "MANIFEST_NOT_FOUND");
      const shipments = await Shipment.find({ _id: { $in: manifest.shipmentIds }, lastMileState: LAST_MILE_STATE.DESTINATION_INWARDED, currentStatus: SHIPMENT_STATUS.RECEIVED, activeDrsId: { $exists: false } }).session(session);
      const requestedIds = new Set(data.shipmentIds.map(id));
      if (!shipments.length || shipments.length !== requestedIds.size || shipments.some((shipment) => !requestedIds.has(id(shipment))))
        throw new ConflictError("Manifest LRs are no longer available. Refresh the manifest and try again", "MANIFEST_INVENTORY_CHANGED");
      const sourceVendorId = manifest.vendorId || await prsVendorId(manifest.shipmentIds, session);
      const vendor = sourceVendorId ? await Vendor.findOne({ _id: sourceVendorId, status: "ACTIVE" }).session(session) : null;
      if (!vendor) throw new BusinessRuleError("The selected manifest has no active PRS vendor", "MANIFEST_VENDOR_REQUIRED");
      if (!manifest.vendorId) { manifest.vendorId = vendor._id; await manifest.save({ session }); }
      if (data.deliveryAgentId) {
        const agent = await User.findOne({ _id: data.deliveryAgentId, role: "EMPLOYEE", status: "ACTIVE", ...(!isAdmin(req.user) && { branchId }) }).session(session);
        if (!agent) throw new BusinessRuleError(isAdmin(req.user) ? "Select an active employee as delivery agent" : "Select an active delivery agent from this branch", "INVALID_DELIVERY_AGENT");
      }
      drs = (await DeliveryRunSheet.create([{ ...data, vendorId: vendor._id, branchId, drsNumber: await generateBusinessNumber("drs", "DRS", session), items: shipments.map((row) => ({ shipmentId: row._id })), workflowStatus: "DRAFT", createdBy: req.user._id }], { session }))[0];
      const claim = await Shipment.updateMany({ _id: { $in: data.shipmentIds }, activeDrsId: { $exists: false }, lastMileState: LAST_MILE_STATE.DESTINATION_INWARDED }, { $set: { activeDrsId: drs._id, lastMileState: LAST_MILE_STATE.DRS_ASSIGNED } }, { session });
      if (claim.modifiedCount !== shipments.length) throw new ConflictError("Another user assigned an LR to a DRS", "DRS_ASSIGNMENT_RACE");
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.DRS_ASSIGNED, branchId, req.user, `Assigned to ${drs.drsNumber}`, { drsId: drs._id }), { session, ordered: true });
      await audit(session, req, "LAST_MILE_DRS_CREATED", "DeliveryRunSheet", drs._id, null, { number: drs.drsNumber, manifestId: manifest._id, shipmentCount: shipments.length });
    }); return dto(drs);
  } finally { await session.endSession(); }
}

export async function listDrs(query, user) {
  const options = listQuery(query); const filter = isAdmin(user) ? (query.branchId ? { branchId: query.branchId } : {}) : { branchId: user.branchId };
  if (query.status) filter.status = query.status; if (query.workflowStatus) filter.workflowStatus = query.workflowStatus;
  if (query.search) filter.$or = ["drsNumber", "vehicleNumber", "driverName", "route"].map((key) => ({ [key]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([DeliveryRunSheet.find(filter).populate("branchId deliveryAgentId vendorId manifestId shipmentIds").sort(options.sort).skip(options.skip).limit(options.limit).lean(), DeliveryRunSheet.countDocuments(filter)]);
  return paginated(items.map(dto), total, options);
}
export async function getDrs(recordId, user) {
  const drs = await DeliveryRunSheet.findById(recordId).populate("branchId deliveryAgentId vendorId manifestId shipmentIds podShipmentIds");
  if (!drs) throw new NotFoundError("DRS not found", "DRS_NOT_FOUND"); assertBranch(drs, user); return dto(drs);
}

async function transitionDrs(recordId, expected, next, req, action) {
  const session = await mongoose.startSession();
  try {
    let drs;
    await session.withTransaction(async () => {
      drs = await DeliveryRunSheet.findById(recordId).session(session); if (!drs) throw new NotFoundError("DRS not found", "DRS_NOT_FOUND"); assertBranch(drs, req.user);
      if (drs.workflowStatus !== expected) throw new ConflictError(`DRS must be ${expected}`, "INVALID_DRS_TRANSITION");
      const before = drs.workflowStatus; drs.workflowStatus = next;
      if (next === "READY_FOR_DISPATCH") { drs.finalizedAt = new Date(); drs.finalizedBy = req.user._id; }
      if (next === "DISPATCHED") { drs.dispatchedAt = new Date(); drs.dispatchedBy = req.user._id; }
      await drs.save({ session });
      if (next === "DISPATCHED") {
        const shipments = await Shipment.find({ _id: { $in: drs.shipmentIds }, activeDrsId: drs._id }).session(session);
        if (shipments.length !== drs.shipmentIds.length) throw new ConflictError("DRS shipment assignment changed", "DRS_ASSIGNMENT_INVALID");
        await Shipment.updateMany({ _id: { $in: drs.shipmentIds } }, { $set: { lastMileState: LAST_MILE_STATE.OUT_FOR_DELIVERY, currentLocation: `Out for delivery - ${drs.route}` } }, { session });
        await PackageUnit.updateMany({ shipmentId: { $in: drs.shipmentIds } }, { $set: { status: "OUT_FOR_DELIVERY", currentCustodianType: drs.deliveryAgentId ? "EMPLOYEE" : "VEHICLE", currentCustodianId: id(drs.deliveryAgentId || drs._id) } }, { session });
        await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.OUT_FOR_DELIVERY, drs.branchId, req.user, `Dispatched under ${drs.drsNumber}`, { drsId: drs._id }), { session, ordered: true });
      }
      await audit(session, req, action, "DeliveryRunSheet", drs._id, { workflowStatus: before }, { workflowStatus: next });
    }); return dto(drs);
  } finally { await session.endSession(); }
}
export const finalizeDrs = (recordId, req) => transitionDrs(recordId, "DRAFT", "READY_FOR_DISPATCH", req, "LAST_MILE_DRS_FINALIZED");
export const dispatchDrs = (recordId, req) => transitionDrs(recordId, "READY_FOR_DISPATCH", "DISPATCHED", req, "LAST_MILE_DRS_DISPATCHED");

export async function recordDeliveryAttempt(recordId, shipmentId, data, req) {
  const session = await mongoose.startSession();
  try {
    let drs;
    await session.withTransaction(async () => {
      drs = await DeliveryRunSheet.findById(recordId).session(session); if (!drs) throw new NotFoundError("DRS not found", "DRS_NOT_FOUND"); assertBranch(drs, req.user);
      if (drs.workflowStatus !== "DISPATCHED") throw new ConflictError("DRS is not dispatched", "DRS_NOT_DISPATCHED");
      const item = drs.items.find((row) => id(row.shipmentId) === shipmentId); if (!item) throw new NotFoundError("LR not found on DRS", "DRS_SHIPMENT_NOT_FOUND");
      if (item.attemptStatus !== "PENDING") throw new ConflictError("Delivery attempt is already recorded", "ATTEMPT_ALREADY_RECORDED");
      if (data.outcome !== "DELIVERED" && !data.failureReason) throw new BusinessRuleError("Failure reason is required", "FAILURE_REASON_REQUIRED");
      item.attemptStatus = data.outcome; item.failureReason = data.failureReason; item.nextAction = data.nextAction; item.reattemptDate = data.reattemptDate; item.remarks = data.remarks; item.attemptedAt = new Date(); item.attemptedBy = req.user._id;
      if (drs.items.every((row) => row.attemptStatus !== "PENDING")) drs.workflowStatus = "CLOSURE_PENDING"; await drs.save({ session });
      const shipment = await Shipment.findOne({ _id: shipmentId, activeDrsId: drs._id }).session(session); if (!shipment) throw new ConflictError("LR is no longer assigned to this DRS", "DRS_ASSIGNMENT_INVALID");
      shipment.lastDeliveryAttemptAt = new Date();
      if (data.outcome !== "DELIVERED") { shipment.lastMileState = LAST_MILE_STATE.DELIVERY_FAILED; shipment.currentLocation = "Delivery attempt failed"; }
      await shipment.save({ session });
      await ShipmentEvent.create(eventRows([shipment], data.outcome === "DELIVERED" ? TRACKING_EVENT_STATUS.DELIVERY_ATTEMPTED : TRACKING_EVENT_STATUS.DELIVERY_FAILED, drs.branchId, req.user, data.remarks || data.failureReason || "Delivery successful; POD pending", { drsId: drs._id }), { session });
      await audit(session, req, "LAST_MILE_DELIVERY_ATTEMPT", "DeliveryRunSheet", drs._id, null, { shipmentId, outcome: data.outcome, failureReason: data.failureReason });
    }); return dto(drs);
  } finally { await session.endSession(); }
}

export async function closeDrs(recordId, req) {
  const session = await mongoose.startSession();
  try {
    let drs;
    await session.withTransaction(async () => {
      drs = await DeliveryRunSheet.findById(recordId).session(session); if (!drs) throw new NotFoundError("DRS not found", "DRS_NOT_FOUND"); assertBranch(drs, req.user);
      if (!["DISPATCHED", "CLOSURE_PENDING"].includes(drs.workflowStatus)) throw new ConflictError("DRS is not ready for closure", "DRS_NOT_READY_TO_CLOSE");
      if (drs.items.some((row) => row.attemptStatus === "PENDING")) throw new ConflictError("Record an outcome for every LR", "ATTEMPT_INCOMPLETE");
      const deliveredIds = drs.items.filter((row) => row.attemptStatus === "DELIVERED").map((row) => id(row.shipmentId));
      const podIds = new Set(drs.podShipmentIds.map(id)); if (deliveredIds.some((shipmentId) => !podIds.has(shipmentId))) throw new ConflictError("POD is required for every delivered LR", "POD_INCOMPLETE");
      const failedIds = drs.items.filter((row) => row.attemptStatus !== "DELIVERED").map((row) => row.shipmentId);
      const now = new Date(); drs.status = "CLOSED"; drs.workflowStatus = "CLOSED"; drs.closedAt = now; drs.closedBy = req.user._id; await drs.save({ session });
      await Shipment.updateMany({ _id: { $in: deliveredIds }, activeDrsId: drs._id }, { $set: { currentStatus: SHIPMENT_STATUS.CLOSED, currentLocation: "Delivered", lastMileState: LAST_MILE_STATE.DELIVERED, deliveredAt: now, deliveredBy: req.user._id }, $unset: { activeDrsId: 1 } }, { session });
      await Shipment.updateMany({ _id: { $in: failedIds }, activeDrsId: drs._id }, { $set: { currentStatus: SHIPMENT_STATUS.RECEIVED, currentLocation: "Destination hub - reattempt pending", lastMileState: LAST_MILE_STATE.DESTINATION_INWARDED }, $unset: { activeDrsId: 1 } }, { session });
      await PackageUnit.updateMany({ shipmentId: { $in: deliveredIds } }, { $set: { status: "DELIVERED", currentLocation: "Delivered", currentCustodianType: "CUSTOMER" } }, { session });
      const shipments = await Shipment.find({ _id: { $in: drs.shipmentIds } }).session(session);
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.DRS_CLOSED, drs.branchId, req.user, `DRS ${drs.drsNumber} closed`, { drsId: drs._id }), { session, ordered: true });
      const deliveredShipments = shipments.filter((shipment) => deliveredIds.includes(id(shipment._id)));
      if (deliveredShipments.length) await ShipmentEvent.create(eventRows(deliveredShipments, TRACKING_EVENT_STATUS.DELIVERED, drs.branchId, req.user, `Delivered under ${drs.drsNumber}`, { drsId: drs._id }), { session, ordered: true });
      await audit(session, req, "LAST_MILE_DRS_CLOSED", "DeliveryRunSheet", drs._id, null, { delivered: deliveredIds.length, reattempt: failedIds.length });
    }); return dto(drs);
  } finally { await session.endSession(); }
}
