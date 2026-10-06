import { operationsOffice } from "./operations-office.service.js";
import { locationKey, sameLocation, shipmentDestination } from "../utils/locations.js";
import { hasCrossBranchAccess as hasFullOperationsAccess } from "../utils/access.js";
import mongoose from "mongoose";
import { ACTIVE, LAST_MILE_STATE, MIDDLE_MILE_STATE, SHIPMENT_STATUS, TRACKING_EVENT_STATUS } from "../constants/workflow.js";
import {
  Branch,
  BusinessMaster,
  LoadingTally,
  Manifest,
  MovementLeg,
  PackageUnit,
  PickupRequest,
  Segregation,
  Shipment,
  ShipmentEvent,
  Trip,
  Vendor,
} from "../models/index.js";
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const id = (value) => (value?._id ?? value)?.toString();
const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });
const isAdmin = hasFullOperationsAccess;
const operatingBranch = (requested, user) => {
  const branchId = isAdmin(user) ? requested : user.branchId;
  if (!branchId) throw new BusinessRuleError("Select an operating hub", "HUB_REQUIRED");
  if (!isAdmin(user) && requested && id(requested) !== id(user.branchId)) throw new AuthorizationError("You can operate only your assigned hub");
  return branchId;
};
const assertBranch = (record, user) => {
  if (!isAdmin(user) && id(record.branchId || record.fromHubId) !== id(user.branchId)) throw new AuthorizationError("You can operate only your assigned hub");
};
const totals = (shipments) => ({
  totalLrs: shipments.length,
  totalPackages: shipments.reduce((sum, row) => sum + Number(row.packageCount || 0), 0),
  totalWeightKg: shipments.reduce((sum, row) => sum + Number(row.weightKg || 0), 0),
});
const eventRows = (shipments, state, branchId, user, remarks, refs = {}) => shipments.map((shipment) => ({
  shipmentId: shipment._id,
  status: state,
  location: shipment.currentLocation || "Hub",
  branchId,
  remarks,
  updatedBy: user._id,
  ...refs,
}));
async function ensureHub(hubId, session) {
  const hub = await Branch.findOne({ _id: hubId, status: ACTIVE.ACTIVE }).session(session);
  if (!hub) throw new BusinessRuleError("Select an active hub", "INVALID_HUB");
  return hub;
}
async function ensureRoute(routeId, session) {
  if (!routeId) return null;
  const route = await BusinessMaster.findOne({ _id: routeId, type: "ROUTE", status: ACTIVE.ACTIVE }).session(session);
  if (!route) throw new BusinessRuleError("Select an active route", "INVALID_ROUTE");
  return route;
}
async function nextLegNumber(shipmentId, session) {
  const latest = await MovementLeg.findOne({ shipmentId }).sort({ legNumber: -1 }).select("legNumber").session(session).lean();
  return Number(latest?.legNumber || 0) + 1;
}

export async function hubInward(data, req) {
  const branchId = operatingBranch(data.branchId, req.user);
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await Shipment.findOne(data.shipmentId ? { _id: data.shipmentId } : { lrNumber: data.lrNumber.toUpperCase() }).session(session);
      if (!shipment) throw new NotFoundError("LR not found", "SHIPMENT_NOT_FOUND");
      if (![SHIPMENT_STATUS.BOOKED, SHIPMENT_STATUS.IN_TRANSIT].includes(shipment.currentStatus)) throw new ConflictError("LR is not eligible for origin hub inward", "SHIPMENT_NOT_ELIGIBLE");
      if (shipment.movementState && ![MIDDLE_MILE_STATE.DESTINATION_HUB_INWARDED].includes(shipment.movementState)) throw new ConflictError("LR already has an active Middle Mile movement", "ACTIVE_MOVEMENT_EXISTS");
      if (!isAdmin(req.user) && !shipment.movementState && id(shipment.originBranchId) !== id(branchId)) throw new AuthorizationError("LR must be inwarded at its origin hub");
      if (!isAdmin(req.user) && shipment.movementState === MIDDLE_MILE_STATE.DESTINATION_HUB_INWARDED && id(shipment.currentHubId) !== id(branchId)) throw new AuthorizationError("LR is not available at this hub");
      if (id(branchId) === id(data.nextHubId)) throw new BusinessRuleError("Next hub must differ from current hub", "INVALID_NEXT_HUB");
      const [hub, nextHub] = await Promise.all([ensureHub(branchId, session), ensureHub(data.nextHubId, session), ensureRoute(data.routeId, session)]);
      if (shipment.pickupRequestId) {
        const pickup = await PickupRequest.findById(shipment.pickupRequestId).select("status").session(session);
        if (!pickup || pickup.status !== "DISPATCHED") throw new ConflictError("First Mile pickup must be dispatched before hub inward", "FIRST_MILE_NOT_COMPLETED");
      }
      const packages = await PackageUnit.find({ shipmentId: shipment._id }).session(session);
      if (packages.length !== shipment.packageCount) throw new ConflictError("Package count does not match the LR", "PACKAGE_COUNT_MISMATCH");
      const leg = (await MovementLeg.create([{
        shipmentId: shipment._id,
        legNumber: await nextLegNumber(shipment._id, session),
        fromHubId: branchId,
        toHubId: data.nextHubId,
        routeId: data.routeId,
        status: MIDDLE_MILE_STATE.HUB_INWARDED,
        inwardedAt: new Date(),
        operatedBy: req.user._id,
        remarks: data.remarks,
      }], { session }))[0];
      shipment.currentHubId = branchId;
      shipment.nextHubId = data.nextHubId;
      shipment.routeId = data.routeId;
      shipment.activeMovementLegId = leg._id;
      shipment.movementState = MIDDLE_MILE_STATE.HUB_INWARDED;
      shipment.currentLocation = hub.name;
      await shipment.save({ session });
      await PackageUnit.updateMany({ shipmentId: shipment._id }, {
        $set: { status: "HUB_INWARD", currentLocation: hub.name, currentCustodianType: "BRANCH", currentCustodianId: id(branchId) },
        $push: { scans: { action: "HUB_INWARD", location: hub.name, branchId, remarks: data.remarks || "Origin hub inward", scannedBy: req.user._id } },
      }, { session });
      await ShipmentEvent.create(eventRows([shipment], TRACKING_EVENT_STATUS.HUB_INWARDED, branchId, req.user, `Inwarded at ${hub.name}; next hub ${nextHub.name}`, { movementLegId: leg._id }), { session });
      await audit(session, req, "MIDDLE_MILE_HUB_INWARD", "Shipment", shipment._id, null, { lrNumber: shipment.lrNumber, currentHubId: id(branchId), nextHubId: id(data.nextHubId) });
    });
    return dto(shipment);
  } finally { await session.endSession(); }
}

export async function sortingInventory(query, _user) {
  const options = listQuery(query);
  const branchId = null;
  const filter = await routeInventoryFilter(query.routeId, branchId);
  if (query.destination) filter.$and = [...(filter.$and || []), { "lrDetails.to": cityPattern(query.destination) }];
  if (query.destinationPincode) filter["lrDetails.consigneePincode"] = query.destinationPincode;
  if (query.search) filter.$or = ["lrNumber", "senderName", "receiverName"].map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([
    Shipment.find(filter).populate("customerId originBranchId destinationBranchId currentHubId nextHubId routeId").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    Shipment.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}

export async function createSorting(data, req) {
  const office = await operationsOffice();
  const session = await mongoose.startSession();
  try {
    let sorting;
    await session.withTransaction(async () => {
      const route = await ensureRoute(data.routeId, session);
      const filter = await routeInventoryFilter(data.routeId, null, session);
      if (data.destination) filter.$and = [...(filter.$and || []), { "lrDetails.to": cityPattern(data.destination) }];
      if (data.destinationPincode) filter["lrDetails.consigneePincode"] = data.destinationPincode;
      const shipments = await Shipment.find({ ...filter, _id: { $in: data.shipmentIds } }).session(session);
      if (shipments.length !== data.shipmentIds.length) throw new ConflictError("Select available LRs matching this destination city and PIN code", "INVALID_SHIPMENT_SELECTION");
      sorting = (await Segregation.create([{
        segregationNumber: await generateBusinessNumber("segregation", "SEG", session),
        branchId: office._id, fromHubId: office._id, nextHubId: office._id, routeId: route?._id,
        origin: office.city || office.name, destination: data.destination || route?.destination, destinationPincode: data.destinationPincode, shipmentIds: data.shipmentIds, status: "READY",
        items: shipments.map((shipment) => ({ shipmentId: shipment._id, status: "SORTED", sortedAt: new Date(), sortedBy: req.user._id })),
        remarks: data.remarks, createdBy: req.user._id,
      }], { session }))[0];
      for (const shipment of shipments) {
        const leg = (await MovementLeg.create([{
          shipmentId: shipment._id, legNumber: await nextLegNumber(shipment._id, session),
          fromHubId: office._id, toHubId: office._id, routeId: route?._id, segregationId: sorting._id,
          status: MIDDLE_MILE_STATE.SORTED, sortedAt: new Date(), operatedBy: req.user._id,
        }], { session }))[0];
        shipment.currentHubId = office._id; shipment.nextHubId = office._id; shipment.routeId = route?._id;
        shipment.currentLocation = office.city || office.name; shipment.activeMovementLegId = leg._id; shipment.movementState = MIDDLE_MILE_STATE.SORTED;
        await shipment.save({ session });
      }
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.SORTED, office._id, req.user, `Sorted under ${sorting.segregationNumber}`), { session });
      await audit(session, req, "MIDDLE_MILE_SORTED", "Segregation", sorting._id, null, { number: sorting.segregationNumber, shipmentCount: shipments.length });
    });
    return dto(sorting);
  } finally { await session.endSession(); }
}

export async function listSortings(query, _user) {
  const options = listQuery(query);
  const filter = { status: "READY", loadingTallyId: { $exists: false } };
  if (query.routeId) filter.routeId = query.routeId;
  if (query.destination) filter.destination = cityPattern(query.destination);
  if (query.destinationPincode) filter.destinationPincode = query.destinationPincode;
  const assigned = await LoadingTally.distinct("segregationId");
  filter._id = { $nin: assigned };
  const [items, total] = await Promise.all([
    Segregation.find(filter).populate("routeId shipmentIds").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    Segregation.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}

export async function setShipmentHold(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await Shipment.findById(recordId).session(session);
      if (!shipment) throw new NotFoundError("LR not found", "SHIPMENT_NOT_FOUND");
      if (!isAdmin(req.user) && id(shipment.currentHubId) !== id(req.user.branchId)) throw new AuthorizationError("LR is at another hub");
      if (data.action === "HOLD") {
        if (![MIDDLE_MILE_STATE.HUB_INWARDED, MIDDLE_MILE_STATE.SORTING_PENDING, MIDDLE_MILE_STATE.SORTED].includes(shipment.movementState)) throw new ConflictError("LR cannot be held at this stage", "HOLD_NOT_ALLOWED");
        shipment.movementHold = { previousState: shipment.movementState, reason: data.reason, heldAt: new Date(), heldBy: req.user._id };
        shipment.movementState = MIDDLE_MILE_STATE.HOLD;
        await PackageUnit.updateMany({ shipmentId: shipment._id }, { $set: { status: "HOLD" }, $push: { scans: { action: "HOLD", location: shipment.currentLocation || "Hub", branchId: shipment.currentHubId, remarks: data.reason, scannedBy: req.user._id } } }, { session });
      } else {
        if (shipment.movementState !== MIDDLE_MILE_STATE.HOLD || !shipment.movementHold?.previousState) throw new ConflictError("LR is not on hold", "SHIPMENT_NOT_ON_HOLD");
        shipment.movementState = shipment.movementHold.previousState;
        shipment.movementHold.releasedAt = new Date(); shipment.movementHold.releasedBy = req.user._id; shipment.movementHold.reason = data.reason;
        const packageStatus = shipment.movementState === MIDDLE_MILE_STATE.SORTED ? "SORTED" : "HUB_INWARD";
        await PackageUnit.updateMany({ shipmentId: shipment._id, status: "HOLD" }, { $set: { status: packageStatus } }, { session });
      }
      await shipment.save({ session });
      await MovementLeg.updateOne({ _id: shipment.activeMovementLegId }, { $set: { status: shipment.movementState, remarks: data.reason } }, { session });
      await ShipmentEvent.create(eventRows([shipment], data.action === "HOLD" ? TRACKING_EVENT_STATUS.HOLD : shipment.movementState, shipment.currentHubId, req.user, data.reason, { movementLegId: shipment.activeMovementLegId }), { session });
      await audit(session, req, `MIDDLE_MILE_${data.action}`, "Shipment", shipment._id, null, { lrNumber: shipment.lrNumber, movementState: shipment.movementState, reason: data.reason });
    });
    return dto(shipment);
  } finally { await session.endSession(); }
}

const availableStates = [null, MIDDLE_MILE_STATE.HUB_INWARDED, MIDDLE_MILE_STATE.SORTING_PENDING, MIDDLE_MILE_STATE.DESTINATION_HUB_INWARDED];

const cityPattern = (value) => new RegExp(`^${escapeSearch(String(value || "").trim()).replace(/\s+/g, "\\s+")}$`, "i");
async function routeInventoryFilter(routeId, _branchId, session = null) {
  const pendingPickupIds = await PickupRequest.distinct("_id", { status: { $ne: "DISPATCHED" } }).session(session);
  const filter = { movementState: { $in: availableStates }, currentStatus: { $in: [SHIPMENT_STATUS.BOOKED, SHIPMENT_STATUS.IN_TRANSIT] }, pickupRequestId: { $nin: pendingPickupIds } };
  if (routeId) {
    const route = await ensureRoute(routeId, session);
    const routes = await BusinessMaster.find({ type: "ROUTE", status: "ACTIVE" }).session(session);
    const branches = await Branch.find({}).session(session);
    const canonical = (city) => locationKey(branches.find((branch) => sameLocation(branch.name, city))?.city || city);
    const origin = canonical(route.origin);
    const destinations = new Set([canonical(route.destination)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of routes) if (destinations.has(canonical(candidate.origin)) && candidate.destination && canonical(candidate.destination) !== origin && !destinations.has(canonical(candidate.destination))) { destinations.add(canonical(candidate.destination)); changed = true; }
    }
    const originBranches = branches.filter((branch) => canonical(branch.city || branch.name) === origin);
    const destinationBranches = branches.filter((branch) => destinations.has(canonical(branch.city || branch.name)));
    const originPatterns = [...new Set([route.origin, origin, ...originBranches.map((branch) => branch.name)])].map(cityPattern);
    const destinationPatterns = [...new Set([...destinations, ...destinationBranches.map((branch) => branch.name)])].map(cityPattern);
    filter.$and = [
      { $or: [
        { movementState: null, "lrDetails.from": { $in: originPatterns } },
        { movementState: { $ne: null }, currentLocation: { $in: originPatterns } },
        { movementState: null, "lrDetails.from": { $in: [null, ""] }, originBranchId: { $in: originBranches.map((branch) => branch._id) } },
      ] },
      { $or: [{ "lrDetails.to": { $in: destinationPatterns } }, { "lrDetails.to": { $in: [null, ""] }, destinationBranchId: { $in: destinationBranches.map((branch) => branch._id) } }] },
    ];
  }
  return filter;
}

export async function createLoadingTally(data, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      const from = await operationsOffice();
      const to = from;
      const branchId = from._id;
      const segregation = await Segregation.findOne({ _id: data.segregationId, status: "READY", loadingTallyId: { $exists: false } }).session(session);
      if (!segregation || await LoadingTally.exists({ segregationId: data.segregationId }).session(session)) throw new ConflictError("Select an available sorted LR batch for this destination", "SORTING_NOT_AVAILABLE");
      const shipmentIds = segregation.shipmentIds;
      const shipments = await Shipment.find({ _id: { $in: shipmentIds }, movementState: MIDDLE_MILE_STATE.SORTED, currentStatus: { $in: [SHIPMENT_STATUS.BOOKED, SHIPMENT_STATUS.IN_TRANSIT] } }).session(session);
      if (!shipments.length || shipments.length !== shipmentIds.length) throw new ConflictError("Sorted LRs are no longer available for loading", "INVALID_SHIPMENT_SELECTION");
      if (totals(shipments).totalWeightKg > data.vehicleCapacityKg) throw new ConflictError("Sorted LR weight exceeds vehicle capacity", "VEHICLE_CAPACITY_EXCEEDED");
      const units = await PackageUnit.find({ shipmentId: { $in: shipmentIds } }).session(session);
      if (units.some((unit) => ["HOLD", "DAMAGE", "SHORT", "MISROUTE", "CANCELLED"].includes(unit.status))) throw new ConflictError("Resolve blocked packages before loading", "PACKAGE_BLOCKED");
      for (const shipment of shipments) {
        if (units.filter((unit) => id(unit.shipmentId) === id(shipment)).length !== shipment.packageCount) throw new ConflictError("Package count does not match the LR", "PACKAGE_COUNT_MISMATCH");
      }
      tally = (await LoadingTally.create([{
        tallyNumber: await generateBusinessNumber("loading-tally", "LT", session), branchId, fromHubId: from._id, toHubId: to._id,
        origin: segregation.origin || from.city || from.name, destination: segregation.destination,
        loadingBay: data.loadingBay, vehicleType: data.vehicleType, vehicleCapacityKg: data.vehicleCapacityKg, routeId: segregation.routeId, segregationId: segregation._id, shipmentIds: shipmentIds,
        items: shipments.map((shipment) => ({ shipmentId: shipment._id, expectedPackages: shipment.packageCount, scannedPackages: 0, weightKg: shipment.weightKg, status: "PENDING" })),
        ...totals(shipments), status: "TALLY_COMPLETED", completedAt: new Date(), completedBy: req.user._id, remarks: data.remarks, createdBy: req.user._id,
      }], { session }))[0];
      segregation.loadingTallyId = tally._id;
      await segregation.save({ session });
      await MovementLeg.updateMany({ segregationId: segregation._id, status: MIDDLE_MILE_STATE.SORTED }, { $set: { loadingTallyId: tally._id, status: MIDDLE_MILE_STATE.LOADING_TALLY_COMPLETED } }, { session });
      await Shipment.updateMany({ _id: { $in: shipmentIds } }, { $set: { movementState: MIDDLE_MILE_STATE.LOADING_TALLY_COMPLETED } }, { session });
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.LOADING_TALLY_COMPLETED, branchId, req.user, `Selected for ${tally.tallyNumber}`, { loadingTallyId: tally._id }), { session });
      await audit(session, req, "LOADING_TALLY_CREATED", "LoadingTally", tally._id, null, { number: tally.tallyNumber, shipmentCount: shipments.length });
    });
    return dto(tally);
  } finally { await session.endSession(); }
}

export async function scanLoadingTally(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      tally = await LoadingTally.findById(recordId).session(session);
      if (!tally) throw new NotFoundError("Loading tally not found", "TALLY_NOT_FOUND");
      assertBranch(tally, req.user);
      if (!['DRAFT', 'LOADING'].includes(tally.status)) throw new ConflictError("Completed tally cannot be edited", "TALLY_LOCKED");
      const unit = await PackageUnit.findOne({ barcode: data.barcode.trim().toUpperCase() }).session(session);
      if (!unit) throw new NotFoundError("Package barcode not found. Scan the individual package label, including its package suffix (for example LRNUMBER-01OF3).", "PACKAGE_NOT_FOUND");
      if (["HOLD", "DAMAGE", "SHORT", "MISROUTE", "CANCELLED"].includes(unit.status)) throw new ConflictError(`Package is blocked with status ${unit.status}`, "PACKAGE_BLOCKED");
      const item = tally.items.find((row) => id(row.shipmentId) === id(unit.shipmentId));
      if (!item) throw new ConflictError("Package belongs to another route or tally", "PACKAGE_WRONG_TALLY");
      if (tally.items.some((row) => row.scannedBarcodes.includes(unit.barcode))) throw new ConflictError("Package is already scanned in this tally", "DUPLICATE_PACKAGE_SCAN");
      if (item.scannedPackages >= item.expectedPackages) throw new ConflictError("Package scan exceeds expected quantity", "EXCESS_PACKAGE_SCAN");
      item.scannedBarcodes.push(unit.barcode);
      item.scannedPackages = item.scannedBarcodes.length;
      item.status = item.scannedPackages === item.expectedPackages ? "LOADED" : "LOADING";
      tally.status = "LOADING";
      await tally.save({ session });
      unit.status = "LOADED";
      unit.currentLocation = `Loading tally ${tally.tallyNumber}`;
      unit.scans.push({ action: "LOADED", location: unit.currentLocation, branchId: tally.branchId, remarks: tally.tallyNumber, scannedBy: req.user._id });
      await unit.save({ session });
      await audit(session, req, "LOADING_PACKAGE_SCANNED", "LoadingTally", tally._id, null, { number: tally.tallyNumber, barcode: unit.barcode });
    });
    return dto(tally);
  } finally { await session.endSession(); }
}

export async function completeLoadingTally(recordId, req) {
  const session = await mongoose.startSession();
  try {
    let tally;
    await session.withTransaction(async () => {
      tally = await LoadingTally.findById(recordId).session(session);
      if (!tally) throw new NotFoundError("Loading tally not found", "TALLY_NOT_FOUND");
      assertBranch(tally, req.user);
      if (tally.status === "TALLY_COMPLETED" || tally.status === "MANIFEST_READY") throw new ConflictError("Loading tally is already completed", "TALLY_ALREADY_COMPLETED");
      const mismatch = tally.items.find((item) => item.scannedPackages !== item.expectedPackages);
      if (mismatch) throw new ConflictError("Scan every expected package before completing the tally", "PACKAGE_COUNT_MISMATCH");
      if (tally.vehicleCapacityKg && tally.totalWeightKg > tally.vehicleCapacityKg) throw new ConflictError("Loaded weight exceeds selected vehicle capacity", "VEHICLE_CAPACITY_EXCEEDED");
      tally.status = "TALLY_COMPLETED"; tally.completedAt = new Date(); tally.completedBy = req.user._id;
      await tally.save({ session });
      const shipments = await Shipment.find({ _id: { $in: tally.shipmentIds } }).session(session);
      await Shipment.updateMany({ _id: { $in: tally.shipmentIds } }, { $set: { movementState: MIDDLE_MILE_STATE.LOADING_TALLY_COMPLETED } }, { session });
      await MovementLeg.updateMany({ loadingTallyId: tally._id }, { $set: { status: MIDDLE_MILE_STATE.LOADING_TALLY_COMPLETED, loadedAt: new Date() } }, { session });
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.LOADING_TALLY_COMPLETED, tally.branchId, req.user, `Loading tally ${tally.tallyNumber} completed`, { loadingTallyId: tally._id }), { session });
      await audit(session, req, "LOADING_TALLY_COMPLETED", "LoadingTally", tally._id, null, { number: tally.tallyNumber, totalPackages: tally.totalPackages });
    });
    return dto(tally);
  } finally { await session.endSession(); }
}

export async function createManifest(data, req) {
  const session = await mongoose.startSession();
  try {
    let manifest;
    await session.withTransaction(async () => {
      const tally = await LoadingTally.findOne({ _id: data.loadingTallyId, status: "TALLY_COMPLETED" }).session(session);
      if (!tally) throw new BusinessRuleError("Select a completed loading tally", "INVALID_LOADING_TALLY");
      assertBranch(tally, req.user);
      if (await Manifest.exists({ loadingTallyId: tally._id, status: { $ne: "CANCELLED" } }).session(session)) throw new ConflictError("Loading tally already has a manifest", "MANIFEST_ALREADY_EXISTS");
      if (data.vendorId && !(await Vendor.exists({ _id: data.vendorId, status: ACTIVE.ACTIVE }).session(session))) throw new BusinessRuleError("Select an active vendor", "INVALID_VENDOR");
      const [toHub, shipments] = await Promise.all([Branch.findById(tally.toHubId).session(session), Shipment.find({ _id: { $in: tally.shipmentIds } }).session(session)]);
      if (await PackageUnit.exists({ shipmentId: { $in: tally.shipmentIds }, status: { $in: ["HOLD", "DAMAGE", "SHORT", "MISROUTE", "CANCELLED"] } }).session(session)) throw new ConflictError("Resolve blocked packages before confirming loaded LRs", "PACKAGE_BLOCKED");
      const verified = new Set(data.verifiedShipmentIds.map(id));
      if (verified.size !== tally.shipmentIds.length || tally.shipmentIds.some((value) => !verified.has(id(value)))) throw new ConflictError("Verify every LR in the loading tally", "MANIFEST_VERIFICATION_REQUIRED");
      if (shipments.length !== tally.shipmentIds.length || shipments.some((row) => row.movementState !== MIDDLE_MILE_STATE.LOADING_TALLY_COMPLETED)) throw new ConflictError("One or more LRs are no longer available", "SHIPMENT_ALREADY_MANIFESTED");
      const legs = await MovementLeg.find({ _id: { $in: shipments.map((row) => row.activeMovementLegId) }, loadingTallyId: tally._id }).session(session);
      if (legs.length !== shipments.length) throw new ConflictError("LR movement changed; refresh the tally", "SHIPMENT_ALREADY_MANIFESTED");
      manifest = (await Manifest.create([{
        manifestNumber: await generateBusinessNumber("manifest", "MNF", session), branchId: tally.branchId,
        loadingTallyId: tally._id, segregationId: tally.segregationId, fromHubId: tally.fromHubId, toHubId: tally.toHubId, routeId: tally.routeId,
        shipmentIds: tally.shipmentIds, origin: tally.origin, destination: tally.destination || toHub?.city || toHub?.name || "Destination", vendorId: data.vendorId,
        totalLrs: tally.totalLrs, totalPackages: tally.totalPackages, totalWeightKg: tally.totalWeightKg,
        workflowStatus: "LOCKED", lockedAt: new Date(), lockedBy: req.user._id, status: "OPEN", vendorReference: data.vendorReference, remarks: data.remarks, createdBy: req.user._id,
      }], { session }))[0];
      await Shipment.updateMany({ _id: { $in: tally.shipmentIds } }, { $set: { movementState: MIDDLE_MILE_STATE.MANIFESTED } }, { session });
      await MovementLeg.updateMany({ loadingTallyId: tally._id }, { $set: { status: MIDDLE_MILE_STATE.MANIFESTED, manifestId: manifest._id, loadedAt: new Date() } }, { session });
      await PackageUnit.updateMany({ shipmentId: { $in: tally.shipmentIds } }, { $set: { status: "LOADED" } }, { session });
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.MANIFEST_LOCKED, tally.branchId, req.user, `Loaded LRs verified for ${manifest.manifestNumber}`, { manifestId: manifest._id }), { session });
      tally.items.forEach((item) => { item.status = "LOADED"; });
      tally.status = "MANIFEST_READY"; await tally.save({ session });
      await Segregation.updateOne({ _id: tally.segregationId }, { $set: { status: "MANIFESTED", manifestId: manifest._id } }, { session });
      await audit(session, req, "MIDDLE_MILE_MANIFEST_CREATED", "Manifest", manifest._id, null, { number: manifest.manifestNumber, shipmentCount: shipments.length });
    });
    return dto(manifest);
  } finally { await session.endSession(); }
}

export async function finalizeManifest(recordId, req) {
  const session = await mongoose.startSession();
  try {
    let manifest;
    await session.withTransaction(async () => {
      manifest = await Manifest.findById(recordId).session(session);
      if (!manifest) throw new NotFoundError("Manifest not found", "MANIFEST_NOT_FOUND");
      assertBranch(manifest, req.user);
      if (manifest.workflowStatus !== "DRAFT") throw new ConflictError("Only a draft manifest can be finalized", "MANIFEST_NOT_DRAFT");
      const activeShipments = await Shipment.find({ _id: { $in: manifest.shipmentIds } }).session(session);
      if (activeShipments.length !== manifest.shipmentIds.length || activeShipments.some((shipment) => shipment.movementState !== MIDDLE_MILE_STATE.LOADING_TALLY_COMPLETED))
        throw new ConflictError("An LR is no longer ready for this movement manifest", "SHIPMENT_ALREADY_MANIFESTED");
      const activeLegs = await MovementLeg.find({ _id: { $in: activeShipments.map((shipment) => shipment.activeMovementLegId) } }).session(session);
      if (activeLegs.length !== activeShipments.length || activeLegs.some((leg) => id(leg.loadingTallyId) !== id(manifest.loadingTallyId)))
        throw new ConflictError("An LR belongs to another active movement leg", "SHIPMENT_ALREADY_MANIFESTED");
      manifest.workflowStatus = "LOCKED"; manifest.lockedAt = new Date(); manifest.lockedBy = req.user._id;
      await manifest.save({ session });
      const shipments = activeShipments;
      await Shipment.updateMany({ _id: { $in: manifest.shipmentIds } }, { $set: { movementState: MIDDLE_MILE_STATE.MANIFESTED } }, { session });
      await MovementLeg.updateMany({ loadingTallyId: manifest.loadingTallyId }, { $set: { status: MIDDLE_MILE_STATE.MANIFESTED, manifestId: manifest._id } }, { session });
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.MANIFEST_LOCKED, manifest.branchId, req.user, `Manifest ${manifest.manifestNumber} locked`, { manifestId: manifest._id }), { session });
      await audit(session, req, "MIDDLE_MILE_MANIFEST_LOCKED", "Manifest", manifest._id, { workflowStatus: "DRAFT" }, { number: manifest.manifestNumber, workflowStatus: "LOCKED" });
    });
    return dto(manifest);
  } finally { await session.endSession(); }
}

export async function createTrip(data, req) {
  const session = await mongoose.startSession();
  try {
    let trip;
    await session.withTransaction(async () => {
      const manifests = await Manifest.find({ _id: { $in: data.manifestIds }, workflowStatus: "LOCKED", tripId: { $exists: false } }).session(session);
      if (manifests.length !== data.manifestIds.length) throw new ConflictError("Select only locked, unassigned manifests", "INVALID_MANIFEST_SELECTION");
      const first = manifests[0]; assertBranch(first, req.user);
      const route = await ensureRoute(data.routeId, session);
      if (!route) throw new BusinessRuleError("Select a route for this trip", "ROUTE_REQUIRED");
      if (!sameLocation(route.destination, data.destination) || !sameLocation(route.origin, first.origin)) throw new ConflictError("Route must match the trip origin and destination", "ROUTE_DESTINATION_MISMATCH");
      if (!sameLocation(first.destination, data.destination)) throw new ConflictError("Manifest does not match the selected destination", "DESTINATION_MISMATCH");
      if (manifests.some((row) => row.origin !== first.origin || row.destination !== first.destination)) throw new ConflictError("Selected manifests must have the same origin and destination", "INCOMPATIBLE_MANIFESTS");
      if (data.vendorId && !(await Vendor.exists({ _id: data.vendorId, status: ACTIVE.ACTIVE }).session(session))) throw new BusinessRuleError("Select an active vendor", "INVALID_VENDOR");
      if (data.vehicleSource === "VV") {
        const vendor = await Vendor.findById(data.vendorId).session(session);
        if (!vendor?.vehicles.some((vehicle) => vehicle.vehicleNumber === data.vehicleNumber && vehicle.status === ACTIVE.ACTIVE)) throw new BusinessRuleError("Select an active vehicle mapped to the vendor", "INVALID_VENDOR_VEHICLE");
        if (vendor.documents.some((document) => document.expiresAt && document.expiresAt < new Date())) throw new ConflictError("Vendor has an expired compliance document", "COMPLIANCE_EXPIRED");
      }
      for (const masterId of [data.vehicleMasterId, data.driverMasterId].filter(Boolean)) {
        const master = await BusinessMaster.findOne({ _id: masterId, status: ACTIVE.ACTIVE }).session(session);
        if (!master) throw new BusinessRuleError("Selected vehicle or driver is inactive", "INVALID_MASTER");
        if (master.documents.some((document) => document.expiresAt && document.expiresAt < new Date())) throw new ConflictError(`${master.name} has an expired compliance document`, "COMPLIANCE_EXPIRED");
      }
      const shipmentIds = [...new Set(manifests.flatMap((row) => row.shipmentIds.map(id)))];
      const calculated = { totalLrs: manifests.reduce((sum, row) => sum + row.totalLrs, 0), totalPackages: manifests.reduce((sum, row) => sum + row.totalPackages, 0), totalWeightKg: manifests.reduce((sum, row) => sum + row.totalWeightKg, 0) };
      if (data.vehicleCapacityKg && calculated.totalWeightKg > data.vehicleCapacityKg) throw new ConflictError("Manifest weight exceeds vehicle capacity", "VEHICLE_CAPACITY_EXCEEDED");
      const [fromHub, toHub] = await Promise.all([Branch.findById(first.fromHubId).session(session), Branch.findById(first.toHubId).session(session)]);
      trip = (await Trip.create([{
        tripNumber: await generateBusinessNumber("trip", "TRIP", session), branchId: first.branchId,
        tripType: "MIDDLE_MILE", workflowStatus: "READY_FOR_DISPATCH", status: "PLANNED",
        manifestIds: manifests.map((row) => row._id), shipmentIds, fromHubId: first.fromHubId, toHubId: first.toHubId, routeId: route._id,
        origin: first.origin || fromHub?.city || "Nagpur", destination: first.destination || toHub?.city || "Destination",
        sealNumber: data.sealNumber, vehicleSource: data.vehicleSource, vendorId: data.vendorId, vehicleMasterId: data.vehicleMasterId, driverMasterId: data.driverMasterId,
        vehicleNumber: data.vehicleNumber, vehicleType: data.vehicleType, vehicleCapacityKg: data.vehicleCapacityKg,
        driverName: data.driverName, driverMobile: data.driverMobile, departureDate: data.departureDate, expectedArrival: data.expectedArrival,
        freightAmount: data.freightAmount, advanceAmount: data.advanceAmount, ...calculated, remarks: data.remarks, createdBy: req.user._id,
      }], { session }))[0];
      await Manifest.updateMany({ _id: { $in: manifests.map((row) => row._id) } }, { $set: { workflowStatus: "TRIP_ASSIGNED", tripId: trip._id, routeId: route._id } }, { session });
      await Shipment.updateMany({ _id: { $in: shipmentIds } }, { $set: { movementState: MIDDLE_MILE_STATE.TRIP_ASSIGNED, routeId: route._id } }, { session });
      await MovementLeg.updateMany({ manifestId: { $in: manifests.map((row) => row._id) } }, { $set: { status: MIDDLE_MILE_STATE.TRIP_ASSIGNED, tripId: trip._id, routeId: route._id, vehicleNumber: trip.vehicleNumber, driverName: trip.driverName } }, { session });
      const shipments = await Shipment.find({ _id: { $in: shipmentIds } }).session(session);
      await ShipmentEvent.create(eventRows(shipments, TRACKING_EVENT_STATUS.TRIP_ASSIGNED, trip.branchId, req.user, `Assigned to trip ${trip.tripNumber}`, { tripId: trip._id }), { session });
      await audit(session, req, "MIDDLE_MILE_TRIP_CREATED", "Trip", trip._id, null, { number: trip.tripNumber, manifestCount: manifests.length, shipmentCount: shipmentIds.length });
    });
    return dto(trip);
  } finally { await session.endSession(); }
}

export async function dispatchTrip(recordId, req) {
  const session = await mongoose.startSession();
  try {
    let trip;
    await session.withTransaction(async () => {
      trip = await Trip.findOne({ _id: recordId, tripType: "MIDDLE_MILE" }).session(session);
      if (!trip) throw new NotFoundError("Middle Mile trip not found", "TRIP_NOT_FOUND"); assertBranch(trip, req.user);
      if (trip.status !== "PLANNED" || trip.workflowStatus !== "READY_FOR_DISPATCH") throw new ConflictError("Trip is not ready for dispatch", "TRIP_NOT_READY");
      const manifests = await Manifest.find({ _id: { $in: trip.manifestIds }, workflowStatus: "TRIP_ASSIGNED", tripId: trip._id }).session(session);
      if (manifests.length !== trip.manifestIds.length) throw new ConflictError("Trip manifests are no longer dispatchable", "MANIFEST_NOT_READY");
      if (trip.vendorId) {
        const vendor = await Vendor.findOne({ _id: trip.vendorId, status: ACTIVE.ACTIVE }).session(session);
        if (!vendor || vendor.documents.some((document) => document.expiresAt && document.expiresAt < new Date())) throw new ConflictError("Vendor compliance is invalid or expired", "COMPLIANCE_EXPIRED");
      }
      trip.status = "DISPATCHED"; trip.workflowStatus = "IN_TRANSIT"; trip.dispatchedAt = new Date(); await trip.save({ session });
      await Manifest.updateMany({ _id: { $in: trip.manifestIds } }, { $set: { workflowStatus: "DISPATCHED" } }, { session });
      await Shipment.updateMany({ _id: { $in: trip.shipmentIds }, movementState: MIDDLE_MILE_STATE.TRIP_ASSIGNED }, { $set: { currentStatus: SHIPMENT_STATUS.IN_TRANSIT, movementState: MIDDLE_MILE_STATE.IN_TRANSIT, currentLocation: `In transit: ${trip.origin} to ${trip.destination}` } }, { session });
      await MovementLeg.updateMany({ tripId: trip._id }, { $set: { status: MIDDLE_MILE_STATE.IN_TRANSIT, dispatchedAt: trip.dispatchedAt } }, { session });
      const shipments = await Shipment.find({ _id: { $in: trip.shipmentIds } }).session(session);
      await ShipmentEvent.create(eventRows(shipments, SHIPMENT_STATUS.IN_TRANSIT, trip.fromHubId, req.user, `Dispatched under trip ${trip.tripNumber}`, { tripId: trip._id }), { session });
      await audit(session, req, "MIDDLE_MILE_TRIP_DISPATCHED", "Trip", trip._id, { status: "PLANNED" }, { number: trip.tripNumber, status: "DISPATCHED" });
    });
    return dto(trip);
  } finally { await session.endSession(); }
}

export async function arriveTrip(recordId, req) {
  const session = await mongoose.startSession();
  try {
    let trip;
    await session.withTransaction(async () => {
      trip = await Trip.findOne({ _id: recordId, tripType: "MIDDLE_MILE" }).session(session);
      if (!trip) throw new NotFoundError("Middle Mile trip not found", "TRIP_NOT_FOUND");
      if (!isAdmin(req.user) && id(req.user.branchId) !== id(trip.toHubId)) throw new AuthorizationError("Only the destination hub can mark this trip arrived");
      if (trip.status !== "DISPATCHED") throw new ConflictError("Only a dispatched trip can arrive", "INVALID_TRIP_TRANSITION");
      trip.status = "ARRIVED"; trip.workflowStatus = "ARRIVED"; trip.arrivedAt = new Date(); await trip.save({ session });
      await MovementLeg.updateMany({ tripId: trip._id }, { $set: { arrivedAt: trip.arrivedAt } }, { session });
      const arriving = await Shipment.find({ _id: { $in: trip.shipmentIds } }).populate("destinationBranchId", "name city").session(session);
      const destinationBranch = await Branch.findById(trip.toHubId).session(session);
      const destination = sameLocation(trip.destination, destinationBranch?.name) ? destinationBranch.city : trip.destination;
      const final = arriving.filter((shipment) => sameLocation(shipmentDestination(shipment), destination));
      const onward = arriving.filter((shipment) => !sameLocation(shipmentDestination(shipment), destination));
      if (arriving.some((shipment) => !shipmentDestination(shipment))) throw new ConflictError("Set the LR destination before arrival", "LR_DESTINATION_REQUIRED");
      await Shipment.updateMany({ _id: { $in: final.map((shipment) => shipment._id) } }, { $set: { lastMileState: LAST_MILE_STATE.ARRIVED, currentLocation: destination } }, { session });
      for (const shipment of onward) {
        shipment.currentHubId = trip.toHubId; shipment.nextHubId = undefined; shipment.routeId = undefined;
        shipment.currentLocation = trip.destination; shipment.movementState = MIDDLE_MILE_STATE.SORTING_PENDING;
        await shipment.save({ session });
      }
      if (onward.length) {
        await PackageUnit.updateMany({ shipmentId: { $in: onward.map((row) => row._id) } }, { $set: { status: "UNLOADED", currentLocation: trip.destination, currentCustodianType: "BRANCH", currentCustodianId: id(trip.toHubId) } }, { session });
        await MovementLeg.updateMany({ tripId: trip._id, shipmentId: { $in: onward.map((row) => row._id) } }, { $set: { completedAt: trip.arrivedAt } }, { session });
      }
      await audit(session, req, "MIDDLE_MILE_TRIP_ARRIVED", "Trip", trip._id, { status: "DISPATCHED" }, { number: trip.tripNumber, status: "ARRIVED" });
    });
    return dto(trip);
  } finally { await session.endSession(); }
}

export async function destinationInward(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let trip;
    await session.withTransaction(async () => {
      trip = await Trip.findOne({ _id: recordId, tripType: "MIDDLE_MILE", status: "ARRIVED" }).session(session);
      if (!trip) throw new NotFoundError("Arrived Middle Mile trip not found", "TRIP_NOT_FOUND");
      if (!isAdmin(req.user) && id(req.user.branchId) !== id(trip.toHubId)) throw new AuthorizationError("Only the destination hub can inward this trip");
      const expected = new Set(trip.shipmentIds.map(id)); const received = new Set(data.receivedShipmentIds.map(id));
      if (expected.size !== received.size || [...expected].some((shipmentId) => !received.has(shipmentId))) throw new ConflictError("Received LR count does not match the trip manifest", "INWARD_SHIPMENT_MISMATCH");
      const [hub, shipments] = await Promise.all([Branch.findById(trip.toHubId).session(session), Shipment.find({ _id: { $in: trip.shipmentIds } }).session(session)]);
      if (shipments.some((shipment) => id(shipment.destinationBranchId) === id(trip.toHubId)))
        throw new ConflictError("Final-destination LRs must complete Last Mile unloading and QC before inward", "LAST_MILE_UNLOADING_REQUIRED");
      for (const shipment of shipments) {
        shipment.currentHubId = trip.toHubId; shipment.nextHubId = undefined; shipment.routeId = undefined;
        shipment.currentLocation = hub?.name || trip.destination;
        shipment.movementState = MIDDLE_MILE_STATE.DESTINATION_HUB_INWARDED;
        await shipment.save({ session });
      }
      await PackageUnit.updateMany({ shipmentId: { $in: trip.shipmentIds } }, { $set: { status: "HUB_INWARD", currentLocation: hub?.name || trip.destination, currentCustodianType: "BRANCH", currentCustodianId: id(trip.toHubId) }, $push: { scans: { action: "HUB_INWARD", location: hub?.name || trip.destination, branchId: trip.toHubId, remarks: data.remarks || `Destination inward ${trip.tripNumber}`, scannedBy: req.user._id } } }, { session });
      await MovementLeg.updateMany({ tripId: trip._id }, { $set: { status: MIDDLE_MILE_STATE.DESTINATION_HUB_INWARDED, completedAt: new Date() } }, { session });
      trip.status = "CLOSED"; trip.workflowStatus = "CLOSED"; await trip.save({ session });
      await ShipmentEvent.create(shipments.map((shipment) => ({ shipmentId: shipment._id, status: TRACKING_EVENT_STATUS.DESTINATION_HUB_INWARDED, location: hub?.name || trip.destination, branchId: trip.toHubId, tripId: trip._id, movementLegId: shipment.activeMovementLegId, remarks: data.remarks || `Destination inward completed for ${trip.tripNumber}`, updatedBy: req.user._id })), { session });
      await audit(session, req, "MIDDLE_MILE_DESTINATION_INWARD", "Trip", trip._id, { status: "ARRIVED" }, { number: trip.tripNumber, status: "CLOSED", shipmentCount: shipments.length });
    });
    return dto(trip);
  } finally { await session.endSession(); }
}

async function listCollection(Model, query, user, populate = []) {
  const options = listQuery(query); const filter = {};
  if (!isAdmin(user)) {
    if (Model === Trip) filter.$and = [{ $or: [{ branchId: user.branchId }, { toHubId: user.branchId }] }];
    else filter.branchId = user.branchId;
  } else if (query.branchId) filter.branchId = query.branchId;
  if (Model === Trip) filter.tripType = "MIDDLE_MILE";
  if (query.status) filter.status = query.status;
  if (query.search) filter.$or = ["tallyNumber", "manifestNumber", "tripNumber", "destination", "vehicleNumber"].map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  let cursor = Model.find(filter); for (const path of populate) cursor = cursor.populate(path);
  const [items, total] = await Promise.all([cursor.sort(options.sort).skip(options.skip).limit(options.limit).lean(), Model.countDocuments(filter)]);
  return paginated(items.map(dto), total, options);
}
export const listLoadingTallies = (query, user) => listCollection(LoadingTally, query, user, ["fromHubId", "toHubId", "routeId", "segregationId", "items.shipmentId"]);
export const getLoadingTally = async (recordId, user) => {
  const record = await LoadingTally.findById(recordId).populate("fromHubId toHubId routeId segregationId items.shipmentId");
  if (!record) throw new NotFoundError("Loading tally not found", "TALLY_NOT_FOUND");
  assertBranch(record, user);
  const packages = await PackageUnit.find({ shipmentId: { $in: record.items.map((item) => item.shipmentId._id ?? item.shipmentId) } }).select("barcode lrNumber status").sort({ barcode: 1 }).lean();
  return { ...dto(record), packages };
};
export const listManifests = (query, user) => listCollection(Manifest, query, user, ["fromHubId", "toHubId", "routeId", "loadingTallyId", "vendorId"]);
export const listTrips = (query, user) => listCollection(Trip, query, user, ["fromHubId", "toHubId", "routeId", "vendorId", "manifestIds", "shipmentIds"]);
