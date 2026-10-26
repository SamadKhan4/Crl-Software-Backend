import mongoose from "mongoose";
import { audit } from "./audit.service.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { Vendor, Shipment, PickupRequest, PickupRunSheet, Trip, Manifest, DeliveryRunSheet, TmsRegister } from "../models/index.js";
import { hasCrossBranchAccess } from "../utils/access.js";
import { BusinessRuleError, NotFoundError } from "../utils/errors.js";

const id = (value) => String(value?._id ?? value);
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function calculateVendorCommission(vendor, shipments, operations) {
  const rate = Number(vendor.commercial?.rate || 0);
  const basis = vendor.commercial?.rateBasis || "PER_TRIP";
  const trips = operations.filter((row) => row.type === "TRIP").length;
  const pickups = operations.filter((row) => row.type === "PRS").length;
  const units = basis === "PER_KG" ? shipments.reduce((sum, row) => sum + Number(row.weightKg || 0), 0)
    : basis === "PER_BOX" ? shipments.reduce((sum, row) => sum + Number(row.packageCount || 0), 0)
    : basis === "PER_TRIP" ? trips + pickups : shipments.length || operations.length ? 1 : 0;
  return { rateBasis: basis, agreedRate: rate, units, commission: money(rate * units) };
}

export async function vendorSettlementWork(vendorId, user, session = null) {
  const vendor = await Vendor.findById(vendorId).session(session).lean();
  if (!vendor) throw new NotFoundError("Vendor not found", "VENDOR_NOT_FOUND");
  const scoped = hasCrossBranchAccess(user) ? {} : { branchId: user.branchId };
  const where = { vendorId, ...scoped, status: { $ne: "CANCELLED" } };
  const queries = [
    () => PickupRunSheet.find({ ...scoped, $or: [{ vendorId }, { vendorCode: vendor.vendorCode }], status: { $ne: "CANCELLED" } }).session(session).lean(),
    () => Trip.find(where).session(session).lean(),
    () => Manifest.find(where).session(session).lean(),
    () => DeliveryRunSheet.find(where).session(session).lean(),
    () => PickupRequest.find({ ...scoped, "agentAssignment.vendorId": vendorId, status: { $ne: "CANCELLED" } }).session(session).lean(),
    () => TmsRegister.find({ ...where, module: { $in: ["PTL", "FTL", "PICKUP", "HANDLING"] } }).session(session).lean(),
    () => TmsRegister.find({ ...scoped, module: "VENDOR_SETTLEMENT", vendorId, status: { $ne: "CANCELLED" } }).session(session).lean(),
  ];
  const results = [];
  if (session) {
    for (const query of queries) results.push(await query());
  } else results.push(...await Promise.all(queries.map((query) => query())));
  const [prs, trips, manifests, drs, pickups, registers, previous] = results;
  const settledLrs = new Set(previous.flatMap((row) => row.shipmentIds || []).map(id));
  const settledOps = new Set(previous.flatMap((row) => row.metadata?.operations || []).map((row) => row.key));
  const operations = [
    ...prs.map((row) => ({ ...row, type: "PRS", number: row.prsNumber, date: row.pickupDate, recordedCost: row.vendorPayableAmount, advance: 0 })),
    ...trips.map((row) => ({ ...row, type: "TRIP", number: row.tripNumber, date: row.departureDate, recordedCost: row.freightAmount, advance: row.advanceAmount })),
    ...manifests.map((row) => ({ ...row, type: "MANIFEST", number: row.manifestNumber, date: row.createdAt, recordedCost: 0, advance: 0 })),
    ...registers.map((row) => ({ ...row, type: row.module, number: row.recordNumber, date: row.operationDate, recordedCost: row.amount, advance: 0 })),
    ...drs.map((row) => ({ ...row, type: "DRS", number: row.drsNumber, date: row.deliveryDate, recordedCost: 0, advance: 0 })),
  ].map((row) => ({ key: `${row.type}:${row._id}`, id: id(row), type: row.type, number: row.number, date: row.date, branchId: row.branchId, route: row.route || [row.origin, row.destination].filter(Boolean).join(" - "), vehicleNumber: row.vehicleNumber, status: row.status, shipmentIds: (row.shipmentIds || []).map(id), recordedCost: Number(row.recordedCost || 0), advance: Number(row.advance || 0), charges: Object.fromEntries(["detention", "loading", "otherCharge", "tds"].map((key) => [key, Number(row.metadata?.[key] || 0)])), eligible: row.approvalStatus !== "PENDING" && row.approvalStatus !== "REJECTED" && row.status !== "PENDING_APPROVAL" }));
  const availableOps = operations.filter((row) => !settledOps.has(row.key));
  const lrIds = [...new Set([...availableOps.flatMap((row) => row.shipmentIds), ...pickups.map((row) => row.shipmentId).filter(Boolean).map(id)])];
  const shipments = await Shipment.find({ _id: { $in: lrIds }, currentStatus: { $ne: "CANCELLED" } }).session(session).lean();
  const availableLrs = shipments.filter((row) => !settledLrs.has(id(row)));
  const shipmentsForBill = availableLrs.map((row) => ({ id: id(row), lrNumber: row.lrNumber, bookingDate: row.lrDetails?.bookingDate || row.createdAt, senderName: row.senderName, receiverName: row.receiverName, origin: row.lrDetails?.from, destination: row.lrDetails?.to, packageCount: row.packageCount, weightKg: row.weightKg, freight: Number(row.lrDetails?.freightCharges || 0), status: row.currentStatus }));
  const calculation = calculateVendorCommission(vendor, shipmentsForBill, availableOps);
  const advance = money(availableOps.reduce((sum, row) => sum + row.advance, 0));
  const operationDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const due = new Date(`${operationDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + Number(vendor.commercial?.creditDays || 0));
  const reference = availableOps.map((row) => row.number).filter(Boolean).join(", ");
  const sourceInvoice = registers.find((row) => row.documentNumber)?.documentNumber;
  const defaults = {
    title: `Commission settlement - ${vendor.vendorCode} - ${vendor.name}`.slice(0, 180),
    operationDate,
    dueDate: due.toISOString().slice(0, 10),
    documentNumber: sourceInvoice || `VCOM-${vendor.vendorCode}-${operationDate.replaceAll("-", "")}`.slice(0, 120),
    reference: reference.slice(0, 120),
    description: `${shipmentsForBill.length} LRs; ${availableOps.length} operations. ${calculation.rateBasis}: ${calculation.units} x ${calculation.agreedRate} = ${calculation.commission}. ${reference}`.slice(0, 1000),
    metadata: { ...Object.fromEntries(["detention", "loading", "otherCharge", "tds"].map((key) => [key, money(availableOps.reduce((sum, row) => sum + Number(row.charges[key] || 0), 0))])), advance },
  };
  return { vendor, shipments: shipmentsForBill, operations: availableOps, calculation, advance, defaults, branchId: availableOps[0]?.branchId || shipments[0]?.originBranchId, settledLrCount: settledLrs.size };
}

export async function prepareVendorSettlement(data, user, session = null) {
  if (!data.vendorId) throw new BusinessRuleError("Select a vendor", "VENDOR_REQUIRED");
  const work = await vendorSettlementWork(data.vendorId, user, session);
  if (work.vendor.status !== "ACTIVE") throw new BusinessRuleError("Select an active vendor", "VENDOR_INACTIVE");
  if (!work.shipments.length && !work.operations.length) throw new BusinessRuleError("No unsettled vendor work found", "NO_VENDOR_WORK");
  if (work.operations.some((row) => !row.eligible)) throw new BusinessRuleError("Vendor work includes pending or rejected market rate approval", "VENDOR_RATE_APPROVAL_REQUIRED");
  const meta = data.metadata || {};
  const readAmount = (key) => {
    const amount = Number(meta[key] || 0);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new BusinessRuleError(`Invalid ${key}`, "INVALID_SETTLEMENT_AMOUNT");
    return amount;
  };
  const detention = readAmount("detention"), loading = readAmount("loading"), otherCharge = readAmount("otherCharge"), tds = readAmount("tds");
  const advance = meta.advance == null ? work.advance : readAmount("advance");
  const gross = money(work.calculation.commission + detention + loading + otherCharge);
  const deductions = money(tds + advance);
  if (deductions > gross) throw new BusinessRuleError("Deductions exceed settlement gross amount", "DEDUCTIONS_EXCEED_GROSS");
  return { ...data, branchId: data.branchId || work.branchId, shipmentIds: work.shipments.map((row) => row.id), amount: money(gross - deductions), taxAmount: 0, metadata: { detention, loading, otherCharge, tds, advance, ...work.calculation, baseAmount: work.calculation.commission, gross, deductions, payable: money(gross - deductions), vendor: { vendorCode: work.vendor.vendorCode, name: work.vendor.name, address: work.vendor.address, gstNumber: work.vendor.gstNumber }, operations: work.operations, lrDetails: work.shipments } };
}


export async function createVendorSettlement(data, req) {
  if (!data.vendorId) throw new BusinessRuleError("Select a vendor", "VENDOR_REQUIRED");
  const session = await mongoose.startSession();
  try {
    let record;
    await session.withTransaction(async () => {
      // Serialize settlement creation per vendor so concurrent saves cannot reuse work.
      await Vendor.updateOne({ _id: data.vendorId }, { $inc: { __v: 1 } }, { session });
      const payload = await prepareVendorSettlement(data, req.user, session);
      const branchId = hasCrossBranchAccess(req.user) ? payload.branchId : req.user.branchId;
      if (!branchId) throw new BusinessRuleError("Select an operating branch", "BRANCH_REQUIRED");
      [record] = await TmsRegister.create([{ ...payload, branchId, module: "VENDOR_SETTLEMENT", recordNumber: await generateBusinessNumber("register-vendor_settlement", "VST", session), createdBy: req.user._id }], { session });
      await audit(session, req, "VENDOR_SETTLEMENT_CREATED", "TmsRegister", record._id, null, { number: record.recordNumber, amount: record.amount });
    });
    return { ...record.toObject(), id: record._id };
  } finally {
    await session.endSession();
  }
}
