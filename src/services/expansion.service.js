import mongoose from "mongoose";
import {
  BusinessMaster,
  Customer,
  Invoice,
  PackageUnit,
  RateCard,
  Shipment,
  ShipmentEvent,
  TmsRegister,
  Trip,
  Vendor,
} from "../models/index.js";
import { ROLES } from "../constants/workflow.js";
import { audit } from "./audit.service.js";
import { BusinessRuleError, ConflictError, NotFoundError } from "../utils/errors.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";

const dto = (record) => ({ ...record.toObject(), id: record._id });
const scope = (user) =>
  user.role === ROLES.ADMIN || !user.branchId
    ? {}
    : { $or: [{ branchId: user.branchId }, { branchId: { $exists: false } }, { branchId: null }] };

export async function createMaster(data, req) {
  try {
    const record = await BusinessMaster.create({ ...data, code: data.code.toUpperCase(), createdBy: req.user._id });
    await audit(null, req, "MASTER_CREATED", "BusinessMaster", record._id, null, { name: record.name, type: record.type, code: record.code });
    return dto(record);
  } catch (error) {
    if (error.code === 11000) throw new ConflictError("This master code already exists", "MASTER_CODE_EXISTS");
    throw error;
  }
}

export async function listMasters(query, user) {
  const options = listQuery(query);
  const filter = { ...scope(user), ...(query.type && { type: query.type }), ...(query.status && { status: query.status }) };
  if (query.search) {
    const search = { $regex: escapeSearch(query.search), $options: "i" };
    filter.$and = [{ $or: [{ code: search }, { name: search }, { city: search }, { origin: search }, { destination: search }, { vehicleNumber: search }] }];
  }
  const [items, total] = await Promise.all([
    BusinessMaster.find(filter).populate("branchId vendorId", "branchCode name vendorCode").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    BusinessMaster.countDocuments(filter),
  ]);
  return paginated(items, total, options);
}

export async function getMaster(id, user) {
  const record = await BusinessMaster.findOne({ _id: id, ...scope(user) }).populate("branchId vendorId", "branchCode name vendorCode");
  if (!record) throw new NotFoundError("Master record not found", "MASTER_NOT_FOUND");
  return dto(record);
}

export async function updateMaster(id, data, req) {
  const record = await BusinessMaster.findOne({ _id: id, ...scope(req.user) });
  if (!record) throw new NotFoundError("Master record not found", "MASTER_NOT_FOUND");
  const before = { name: record.name, status: record.status, code: record.code };
  Object.assign(record, data, { updatedBy: req.user._id });
  if (data.code) record.code = data.code.toUpperCase();
  try {
    await record.save();
  } catch (error) {
    if (error.code === 11000) throw new ConflictError("This master code already exists", "MASTER_CODE_EXISTS");
    throw error;
  }
  await audit(null, req, "MASTER_UPDATED", "BusinessMaster", record._id, before, { name: record.name, status: record.status, code: record.code });
  return dto(record);
}

export async function expiringDocuments(query, user) {
  const days = Math.min(180, Math.max(1, Number(query.days) || 30));
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  const records = await BusinessMaster.find({ ...scope(user), status: "ACTIVE", documents: { $elemMatch: { expiresAt: { $gte: now, $lte: until } } } })
    .select("type code name documents")
    .lean();
  return records.flatMap((record) => record.documents
    .filter((document) => document.expiresAt >= now && document.expiresAt <= until)
    .map((document) => ({ masterId: record._id, type: record.type, code: record.code, name: record.name, document })));
}

export async function createRateCard(data, req) {
  if (data.partyType === "CLIENT" && !(await Customer.exists({ _id: data.customerId, status: "ACTIVE" })))
    throw new BusinessRuleError("Select an active client", "INVALID_CLIENT");
  if (data.partyType === "VENDOR" && !(await Vendor.exists({ _id: data.vendorId, status: "ACTIVE" })))
    throw new BusinessRuleError("Select an active vendor", "INVALID_VENDOR");
  try {
    const record = await RateCard.create({ ...data, code: data.code.toUpperCase(), createdBy: req.user._id });
    await audit(null, req, "RATE_CARD_CREATED", "RateCard", record._id, null, { code: record.code, partyType: record.partyType, service: record.service });
    return dto(record);
  } catch (error) {
    if (error.code === 11000) throw new ConflictError("Rate-card code already exists", "RATE_CODE_EXISTS");
    throw error;
  }
}

export async function listRateCards(query) {
  const options = listQuery(query);
  const filter = {};
  for (const key of ["partyType", "customerId", "vendorId", "service", "status"]) if (query[key]) filter[key] = query[key];
  if (query.search) filter.$or = ["code", "origin", "destination", "zone", "vehicleType"].map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([
    RateCard.find(filter).populate("customerId vendorId", "customerCode vendorCode name companyName").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    RateCard.countDocuments(filter),
  ]);
  return paginated(items, total, options);
}

export async function updateRateCard(id, data, req) {
  const record = await RateCard.findById(id);
  if (!record) throw new NotFoundError("Rate card not found", "RATE_CARD_NOT_FOUND");
  const before = { code: record.code, rate: record.rate, status: record.status };
  Object.assign(record, data, { updatedBy: req.user._id });
  await record.save();
  await audit(null, req, "RATE_CARD_UPDATED", "RateCard", record._id, before, { code: record.code, rate: record.rate, status: record.status });
  return dto(record);
}

const metric = (basis, input) => ({
  PER_BOX: input.boxes,
  PER_KG: input.weightKg,
  PER_CHARGED_KG: Math.max(input.weightKg, input.chargedWeightKg),
  PER_TON: input.weightKg / 1000,
  PER_CFT: input.cft,
  PER_CBM: input.cbm,
  PER_KM: input.distanceKm,
  PER_VEHICLE: input.vehicleCount,
  PER_TRIP: 1,
  PER_LR: 1,
  PER_SHIPMENT: 1,
  FIXED: 1,
  PERCENTAGE: input.declaredValue / 100,
}[basis] ?? 1);

const calculateCard = (card, input) => {
  let freight;
  if (card.basis === "SLAB") {
    const quantity = Math.max(input.weightKg, input.chargedWeightKg);
    const slab = card.slabs.find((item) => quantity >= item.from && (item.to == null || quantity <= item.to));
    if (!slab) throw new BusinessRuleError("No matching rate slab", "RATE_SLAB_NOT_FOUND");
    freight = Math.max(slab.minimumCharge || 0, slab.rate);
  } else {
    const quantity = Math.max(metric(card.basis, input), card.basis.includes("KG") ? card.minimumWeightKg : 0);
    freight = Math.max(card.minimumCharge, card.rate * quantity);
  }
  const charges = card.charges.map((charge) => ({ ...charge.toObject(), amount: Number((charge.value * metric(charge.basis, { ...input, declaredValue: freight })).toFixed(2)) }));
  const extras = charges.reduce((sum, charge) => sum + charge.amount, 0);
  const taxable = Number((freight + extras).toFixed(2));
  const taxRate = card.partyType === "VENDOR" ? card.tdsRate : card.gstRate;
  const tax = Number((taxable * taxRate / 100).toFixed(2));
  return { freight: Number(freight.toFixed(2)), charges, taxable, taxRate, tax, total: Number((card.partyType === "VENDOR" ? taxable - tax : taxable + tax).toFixed(2)) };
};

export async function quoteRate(input) {
  const at = input.at || new Date();
  const filter = {
    partyType: input.partyType,
    service: input.service,
    status: "ACTIVE",
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: at } }],
    ...(input.partyType === "CLIENT" ? { customerId: input.customerId } : { vendorId: input.vendorId }),
  };
  const cards = await RateCard.find(filter).sort({ effectiveFrom: -1, createdAt: -1 });
  const score = (card) => ["origin", "destination", "pincode", "zone", "vehicleType"].reduce((total, key) => total + (card[key] ? (String(card[key]).toLowerCase() === String(input[key] || "").toLowerCase() ? 2 : -100) : 0), 0);
  const card = cards.map((item) => ({ item, score: score(item) })).filter(({ score: value }) => value >= 0).sort((a, b) => b.score - a.score)[0]?.item;
  if (!card) throw new NotFoundError("No active rate matched this shipment", "RATE_NOT_FOUND");
  return { rateCard: { id: card._id, code: card.code, basis: card.basis }, ...calculateCard(card, input) };
}

export async function generatePackageUnits(shipment, userId, session) {
  const width = Math.max(2, String(shipment.packageCount).length);
  const units = Array.from({ length: shipment.packageCount }, (_, index) => ({
    barcode: `${shipment.lrNumber}-${String(index + 1).padStart(width, "0")}OF${shipment.packageCount}`,
    shipmentId: shipment._id,
    lrNumber: shipment.lrNumber,
    sequence: index + 1,
    totalPackages: shipment.packageCount,
    status: "GENERATED",
    currentLocation: shipment.currentLocation,
    currentCustodianType: "BRANCH",
    currentCustodianId: shipment.originBranchId?.toString(),
    scans: [{ action: "GENERATED", location: shipment.currentLocation || "Origin", branchId: shipment.originBranchId, scannedBy: userId }],
    createdBy: userId,
  }));
  if (units.length) await PackageUnit.insertMany(units, { session });
}

export async function listPackages(query, user) {
  const options = listQuery(query);
  const shipmentScope = user.role === ROLES.ADMIN || !user.branchId ? {} : { $or: [{ originBranchId: user.branchId }, { destinationBranchId: user.branchId }] };
  const accessible = await Shipment.find(shipmentScope).distinct("_id");
  const filter = { shipmentId: { $in: accessible } };
  if (query.shipmentId) filter.shipmentId = query.shipmentId;
  if (query.lrNumber) filter.lrNumber = query.lrNumber.toUpperCase();
  if (query.status) filter.status = query.status;
  if (query.search) filter.$or = ["barcode", "lrNumber", "currentLocation"].map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([PackageUnit.find(filter).sort(options.sort).skip(options.skip).limit(options.limit).lean(), PackageUnit.countDocuments(filter)]);
  return paginated(items, total, options);
}

export async function packageByBarcode(barcode, user) {
  const unit = await PackageUnit.findOne({ barcode: barcode.toUpperCase() }).populate("shipmentId", "originBranchId destinationBranchId customerId senderName receiverName currentStatus");
  if (!unit) throw new NotFoundError("Package barcode not found", "PACKAGE_NOT_FOUND");
  const shipment = unit.shipmentId;
  if (user.role !== ROLES.ADMIN && user.branchId && ![shipment.originBranchId, shipment.destinationBranchId].some((id) => String(id) === String(user.branchId)))
    throw new NotFoundError("Package barcode not found", "PACKAGE_NOT_FOUND");
  return dto(unit);
}

export async function scanPackage(barcode, data, req) {
  const unit = await PackageUnit.findOne({ barcode: barcode.toUpperCase() });
  if (!unit) throw new NotFoundError("Package barcode not found", "PACKAGE_NOT_FOUND");
  if (unit.status === "CANCELLED") throw new ConflictError("Cancelled package cannot be scanned", "PACKAGE_CANCELLED");
  const scan = { action: data.action, location: data.location, branchId: data.branchId || req.user.branchId, routeCode: data.routeCode, vehicleNumber: data.vehicleNumber, remarks: data.remarks, scannedBy: req.user._id };
  unit.status = data.action;
  unit.currentLocation = data.location;
  unit.currentCustodianType = data.custodianType || (data.vehicleNumber ? "VEHICLE" : "BRANCH");
  unit.currentCustodianId = data.custodianId || data.vehicleNumber || String(data.branchId || req.user.branchId || req.user._id);
  unit.scans.push(scan);
  await unit.save();
  await ShipmentEvent.create({ shipmentId: unit.shipmentId, status: data.action, location: data.location, branchId: scan.branchId, remarks: `${unit.barcode}: ${data.remarks || data.action}`, updatedBy: req.user._id });
  await audit(null, req, "PACKAGE_SCANNED", "PackageUnit", unit._id, null, { barcode: unit.barcode, status: unit.status, location: unit.currentLocation });
  return dto(unit);
}

export async function reprintPackage(barcode, req) {
  const unit = await PackageUnit.findOneAndUpdate({ barcode: barcode.toUpperCase() }, { $inc: { duplicatePrintCount: 1 } }, { new: true });
  if (!unit) throw new NotFoundError("Package barcode not found", "PACKAGE_NOT_FOUND");
  await audit(null, req, "PACKAGE_BARCODE_REPRINTED", "PackageUnit", unit._id, null, { barcode: unit.barcode, duplicatePrintCount: unit.duplicatePrintCount });
  return dto(unit);
}

export async function profitability(query, user) {
  const match = {};
  if (query.customerId) match.customerId = new mongoose.Types.ObjectId(query.customerId);
  if (query.branchId) match.originBranchId = new mongoose.Types.ObjectId(query.branchId);
  if (user.role !== ROLES.ADMIN && user.branchId) match.originBranchId = new mongoose.Types.ObjectId(user.branchId);
  if (query.dateFrom || query.dateTo) match.createdAt = { ...(query.dateFrom && { $gte: query.dateFrom }), ...(query.dateTo && { $lte: query.dateTo }) };
  const shipments = await Shipment.find(match).select("lrNumber customerId originBranchId destinationBranchId lrDetails.totalAmount").populate("customerId", "name companyName").lean();
  const ids = shipments.map((item) => item._id);
  const [costs, tripCosts] = await Promise.all([
    TmsRegister.aggregate([{ $match: { shipmentIds: { $in: ids }, module: { $in: ["PICKUP", "PTL", "FTL", "HANDLING", "VENDOR_SETTLEMENT", "ACCOUNTING"] }, status: { $ne: "CANCELLED" } } }, { $unwind: "$shipmentIds" }, { $match: { shipmentIds: { $in: ids } } }, { $group: { _id: "$shipmentIds", cost: { $sum: { $add: ["$amount", "$taxAmount"] } } } }]),
    Trip.aggregate([{ $match: { shipmentIds: { $in: ids }, status: { $ne: "CANCELLED" }, ...(query.vendorId && { vendorId: new mongoose.Types.ObjectId(query.vendorId) }) } }, { $unwind: "$shipmentIds" }, { $group: { _id: "$shipmentIds", cost: { $sum: { $subtract: ["$freightAmount", "$advanceAmount"] } } } }]),
  ]);
  const costMap = new Map([...costs, ...tripCosts].map((row) => [String(row._id), row.cost]));
  const rows = shipments.map((shipment) => {
    const revenue = Number(shipment.lrDetails?.totalAmount || 0);
    const cost = Number(costMap.get(String(shipment._id)) || 0);
    return { shipmentId: shipment._id, lrNumber: shipment.lrNumber, customer: shipment.customerId?.companyName || shipment.customerId?.name, revenue, cost, profit: Number((revenue - cost).toFixed(2)), marginPercent: revenue ? Number((((revenue - cost) / revenue) * 100).toFixed(2)) : 0 };
  });
  return { rows, totals: rows.reduce((sum, row) => ({ revenue: sum.revenue + row.revenue, cost: sum.cost + row.cost, profit: sum.profit + row.profit }), { revenue: 0, cost: 0, profit: 0 }) };
}

export async function accountingSummary(query, user) {
  const branchFilter = user.role === ROLES.ADMIN ? {} : { branchId: user.branchId };
  const [invoices, vendor, expenses] = await Promise.all([
    Invoice.aggregate([{ $match: { ...branchFilter, status: { $ne: "CANCELLED" } } }, { $group: { _id: null, billed: { $sum: "$totalAmount" }, received: { $sum: "$paidAmount" }, receivable: { $sum: "$balanceAmount" } } }]),
    TmsRegister.aggregate([{ $match: { ...branchFilter, module: "VENDOR_SETTLEMENT", status: { $ne: "CANCELLED" } } }, { $group: { _id: null, payable: { $sum: "$amount" }, tax: { $sum: "$taxAmount" } } }]),
    TmsRegister.aggregate([{ $match: { ...branchFilter, module: "ACCOUNTING", status: { $ne: "CANCELLED" } } }, { $group: { _id: null, expense: { $sum: "$amount" }, tax: { $sum: "$taxAmount" } } }]),
  ]);
  return { billed: invoices[0]?.billed || 0, received: invoices[0]?.received || 0, receivable: invoices[0]?.receivable || 0, payable: vendor[0]?.payable || 0, vendorTax: vendor[0]?.tax || 0, expense: expenses[0]?.expense || 0, expenseTax: expenses[0]?.tax || 0 };
}
