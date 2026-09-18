import mongoose from "mongoose";
import { ACTIVE, DOCUMENT_STATUS, ROLES, SHIPMENT_STATUS } from "../constants/workflow.js";
import {
  Customer,
  DeliveryRunSheet,
  Invoice,
  Manifest,
  MoneyReceipt,
  Quotation,
  Shipment,
  ShipmentDocument,
  ShipmentEvent,
  StationeryTransaction,
  Trip,
  Vendor,
} from "../models/index.js";
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";
import { storageService } from "./storage.service.js";

const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const id = (value) => (value?._id ?? value)?.toString();
const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });
const isAdmin = (user) => user?.role === ROLES.ADMIN;
const summary = (record) => ({
  number:
    record.vendorCode ||
    record.manifestNumber ||
    record.tripNumber ||
    record.drsNumber ||
    record.invoiceNumber ||
    record.receiptNumber ||
    record.quotationNumber ||
    record.transactionNumber,
  status: record.status,
  shipmentCount: record.shipmentIds?.length,
  amount: record.totalAmount ?? record.amount,
});

const branchFor = (data, req) => {
  const branchId = isAdmin(req.user) ? data.branchId : req.user.branchId;
  if (!branchId) throw new BusinessRuleError("Select an operating branch", "BRANCH_REQUIRED");
  if (!isAdmin(req.user) && data.branchId && id(data.branchId) !== id(req.user.branchId))
    throw new AuthorizationError("You can only create records for your assigned branch");
  return branchId;
};

const assertBranchAccess = (record, user) => {
  if (!isAdmin(user) && id(record.branchId) !== id(user.branchId))
    throw new AuthorizationError("You can only access records for your assigned branch");
};

const populate = (query, paths) => paths.reduce((result, path) => result.populate(path), query);
const scope = (query, user) => {
  if (!isAdmin(user)) return { branchId: user.branchId };
  return query.branchId ? { branchId: query.branchId } : {};
};
const createdRange = (query) => {
  if (!query.dateFrom && !query.dateTo) return {};
  return {
    createdAt: {
      ...(query.dateFrom && { $gte: query.dateFrom }),
      ...(query.dateTo && { $lte: new Date(new Date(query.dateTo).setHours(23, 59, 59, 999)) }),
    },
  };
};

async function list(Model, query, user, { search = [], populate: paths = [], global = false } = {}) {
  const options = listQuery(query);
  const filter = { ...(global ? {} : scope(query, user)), ...createdRange(query) };
  for (const key of ["status", "customerId", "vendorId"]) if (query[key]) filter[key] = query[key];
  if (query.search && search.length)
    filter.$or = search.map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const find = populate(Model.find(filter), paths).sort(options.sort).skip(options.skip).limit(options.limit).lean();
  const [items, total] = await Promise.all([find, Model.countDocuments(filter)]);
  return paginated(items.map(dto), total, options);
}

async function get(Model, recordId, user, paths = [], global = false) {
  const record = await populate(Model.findById(recordId), paths);
  if (!record) throw new NotFoundError("Record not found", "RECORD_NOT_FOUND");
  if (!global) assertBranchAccess(record, user);
  return dto(record);
}

const assertShipments = async (shipmentIds, branchId, branchField, allowedStatuses, session) => {
  const shipments = await Shipment.find({ _id: { $in: shipmentIds } }).session(session);
  if (shipments.length !== shipmentIds.length)
    throw new BusinessRuleError("One or more selected LRs do not exist", "INVALID_SHIPMENT_SELECTION");
  for (const shipment of shipments) {
    if (id(shipment[branchField]) !== id(branchId))
      throw new AuthorizationError("All selected LRs must belong to the operating branch");
    if (!allowedStatuses.includes(shipment.currentStatus))
      throw new ConflictError(`LR ${shipment.lrNumber} is not eligible for this operation`, "SHIPMENT_NOT_ELIGIBLE");
  }
  return shipments;
};

const event = (shipment, branchId, user, remarks) => ({
  shipmentId: shipment._id,
  status: SHIPMENT_STATUS.IN_TRANSIT,
  location: shipment.currentLocation || "In transit",
  branchId,
  remarks,
  updatedBy: user._id,
});

async function dispatchShipments(session, shipments, branchId, req, sourceNumber) {
  const booked = shipments.filter((shipment) => shipment.currentStatus === SHIPMENT_STATUS.BOOKED);
  if (!booked.length) return;
  await Shipment.updateMany(
    { _id: { $in: booked.map((shipment) => shipment._id) }, currentStatus: SHIPMENT_STATUS.BOOKED },
    { $set: { currentStatus: SHIPMENT_STATUS.IN_TRANSIT, currentLocation: "Dispatched" } },
    { session },
  );
  await ShipmentEvent.insertMany(
    booked.map((shipment) => event(shipment, branchId, req.user, `Dispatched under ${sourceNumber}`)),
    { session },
  );
}

export async function createVendor(data, req) {
  if (!isAdmin(req.user)) throw new AuthorizationError("Only administrators can create vendors");
  const session = await mongoose.startSession();
  try {
    let vendor;
    await session.withTransaction(async () => {
      vendor = (
        await Vendor.create(
          [{ ...data, vendorCode: await generateBusinessNumber("vendor", "CRLVEN", session), createdBy: req.user._id }],
          { session },
        )
      )[0];
      await audit(session, req, "VENDOR_CREATED", "Vendor", vendor._id, null, summary(vendor));
    });
    return dto(vendor);
  } catch (error) {
    if (error.code === 11000)
      throw new ConflictError("Vendor GST or vehicle mapping already exists", "VENDOR_DUPLICATE");
    throw error;
  } finally {
    await session.endSession();
  }
}

export const listVendors = (query, user) =>
  list(Vendor, query, user, {
    search: ["vendorCode", "name", "mobile", "city", "gstNumber", "vehicles.vehicleNumber"],
    global: true,
  });
export const getVendor = (recordId, user) => get(Vendor, recordId, user, [], true);
export async function updateVendor(recordId, data, req) {
  if (!isAdmin(req.user)) throw new AuthorizationError("Only administrators can update vendors");
  const vendor = await Vendor.findById(recordId);
  if (!vendor) throw new NotFoundError("Vendor not found", "VENDOR_NOT_FOUND");
  const before = summary(vendor);
  Object.assign(vendor, data);
  await vendor.save();
  await audit(null, req, "VENDOR_UPDATED", "Vendor", vendor._id, before, summary(vendor));
  return dto(vendor);
}
export async function setVendorStatus(recordId, status, req) {
  if (!isAdmin(req.user)) throw new AuthorizationError("Only administrators can change vendor status");
  const vendor = await Vendor.findById(recordId);
  if (!vendor) throw new NotFoundError("Vendor not found", "VENDOR_NOT_FOUND");
  const before = summary(vendor);
  vendor.status = status;
  await vendor.save();
  await audit(null, req, "VENDOR_STATUS_CHANGED", "Vendor", vendor._id, before, summary(vendor));
  return dto(vendor);
}

export async function createManifest(data, req) {
  const branchId = branchFor(data, req);
  const session = await mongoose.startSession();
  try {
    let manifest;
    await session.withTransaction(async () => {
      const vendor = await Vendor.findOne({ _id: data.vendorId, status: ACTIVE.ACTIVE }).session(session);
      if (!vendor || !["CO_LOADER", "TRANSPORTER"].includes(vendor.vendorType))
        throw new BusinessRuleError("Select an active co-loader or transporter", "INVALID_VENDOR");
      await assertShipments(
        data.shipmentIds,
        branchId,
        "originBranchId",
        [SHIPMENT_STATUS.BOOKED, SHIPMENT_STATUS.IN_TRANSIT],
        session,
      );
      if (await Manifest.exists({ shipmentIds: { $in: data.shipmentIds }, status: "OPEN" }).session(session))
        throw new ConflictError("A selected LR is already on an open manifest", "SHIPMENT_ALREADY_MANIFESTED");
      manifest = (
        await Manifest.create(
          [
            {
              ...data,
              branchId,
              manifestNumber: await generateBusinessNumber("manifest", "MNF", session),
              createdBy: req.user._id,
            },
          ],
          { session },
        )
      )[0];
      await audit(session, req, "MANIFEST_CREATED", "Manifest", manifest._id, null, summary(manifest));
    });
    return dto(manifest);
  } finally {
    await session.endSession();
  }
}
export const listManifests = (query, user) =>
  list(Manifest, query, user, {
    search: ["manifestNumber", "destination", "vendorReference", "coLoaderStatus"],
    populate: ["vendorId", "branchId"],
  });
export const getManifest = (recordId, user) => get(Manifest, recordId, user, ["vendorId", "branchId", "shipmentIds"]);
export async function updateManifestStatus(recordId, data, req) {
  const session = await mongoose.startSession();
  try {
    let manifest;
    await session.withTransaction(async () => {
      manifest = await Manifest.findById(recordId).session(session);
      if (!manifest) throw new NotFoundError("Manifest not found", "MANIFEST_NOT_FOUND");
      assertBranchAccess(manifest, req.user);
      if (manifest.status !== "OPEN")
        throw new ConflictError("Only an open manifest can be updated", "MANIFEST_CLOSED");
      const before = summary(manifest);
      manifest.coLoaderStatus = data.coLoaderStatus;
      if (data.remarks) manifest.remarks = data.remarks;
      if (data.coLoaderStatus === "DELIVERED") manifest.status = "CLOSED";
      if (data.coLoaderStatus === "IN_TRANSIT") {
        const shipments = await Shipment.find({ _id: { $in: manifest.shipmentIds } }).session(session);
        await dispatchShipments(session, shipments, manifest.branchId, req, manifest.manifestNumber);
      }
      await manifest.save({ session });
      await audit(session, req, "MANIFEST_STATUS_UPDATED", "Manifest", manifest._id, before, summary(manifest));
    });
    return dto(manifest);
  } finally {
    await session.endSession();
  }
}

export async function createTrip(data, req) {
  const branchId = branchFor(data, req);
  const session = await mongoose.startSession();
  try {
    let trip;
    await session.withTransaction(async () => {
      if (data.vendorId && !(await Vendor.exists({ _id: data.vendorId, status: ACTIVE.ACTIVE }).session(session)))
        throw new BusinessRuleError("Select an active vendor", "INVALID_VENDOR");
      await assertShipments(data.shipmentIds, branchId, "originBranchId", [SHIPMENT_STATUS.BOOKED], session);
      if (
        await Trip.exists({
          shipmentIds: { $in: data.shipmentIds },
          status: { $in: ["PLANNED", "DISPATCHED"] },
        }).session(session)
      )
        throw new ConflictError("A selected LR is already on an active trip", "SHIPMENT_ALREADY_ON_TRIP");
      trip = (
        await Trip.create(
          [
            {
              ...data,
              branchId,
              tripNumber: await generateBusinessNumber("trip", "TRIP", session),
              createdBy: req.user._id,
            },
          ],
          { session },
        )
      )[0];
      await audit(session, req, "TRIP_CREATED", "Trip", trip._id, null, summary(trip));
    });
    return dto(trip);
  } finally {
    await session.endSession();
  }
}
export const listTrips = (query, user) =>
  list(Trip, query, user, {
    search: ["tripNumber", "vehicleNumber", "driverName", "origin", "destination"],
    populate: ["vendorId", "branchId"],
  });
export const getTrip = (recordId, user) => get(Trip, recordId, user, ["vendorId", "branchId", "shipmentIds"]);
export async function updateTripStatus(recordId, data, req) {
  const allowed = { PLANNED: ["DISPATCHED", "CANCELLED"], DISPATCHED: ["ARRIVED"], ARRIVED: ["CLOSED"] };
  const session = await mongoose.startSession();
  try {
    let trip;
    await session.withTransaction(async () => {
      trip = await Trip.findById(recordId).session(session);
      if (!trip) throw new NotFoundError("Trip not found", "TRIP_NOT_FOUND");
      assertBranchAccess(trip, req.user);
      if (!allowed[trip.status]?.includes(data.status))
        throw new ConflictError("Invalid trip status transition", "INVALID_TRIP_TRANSITION");
      const before = summary(trip);
      trip.status = data.status;
      if (data.remarks) trip.remarks = data.remarks;
      if (data.status === "DISPATCHED") {
        const shipments = await Shipment.find({ _id: { $in: trip.shipmentIds } }).session(session);
        await dispatchShipments(session, shipments, trip.branchId, req, trip.tripNumber);
      }
      await trip.save({ session });
      await audit(session, req, "TRIP_STATUS_UPDATED", "Trip", trip._id, before, summary(trip));
    });
    return dto(trip);
  } finally {
    await session.endSession();
  }
}

export async function createDrs(data, req) {
  const branchId = branchFor(data, req);
  const session = await mongoose.startSession();
  try {
    let drs;
    await session.withTransaction(async () => {
      await assertShipments(
        data.shipmentIds,
        branchId,
        "destinationBranchId",
        [
          SHIPMENT_STATUS.RECEIVED,
          SHIPMENT_STATUS.LR_IMAGE_UPLOADED,
          SHIPMENT_STATUS.LR_IMAGE_VERIFIED,
          SHIPMENT_STATUS.COMPLETED,
        ],
        session,
      );
      if (await DeliveryRunSheet.exists({ shipmentIds: { $in: data.shipmentIds }, status: "OPEN" }).session(session))
        throw new ConflictError("A selected LR is already on an open DRS", "SHIPMENT_ALREADY_ON_DRS");
      drs = (
        await DeliveryRunSheet.create(
          [
            {
              ...data,
              branchId,
              drsNumber: await generateBusinessNumber("drs", "DRS", session),
              createdBy: req.user._id,
            },
          ],
          { session },
        )
      )[0];
      await audit(session, req, "DRS_CREATED", "DeliveryRunSheet", drs._id, null, summary(drs));
    });
    return dto(drs);
  } finally {
    await session.endSession();
  }
}
export const listDrs = (query, user) =>
  list(DeliveryRunSheet, query, user, {
    search: ["drsNumber", "vehicleNumber", "driverName", "route"],
    populate: ["branchId"],
  });
export const getDrs = (recordId, user) =>
  get(DeliveryRunSheet, recordId, user, ["branchId", "shipmentIds", "podShipmentIds"]);
export async function updateDrsVehicle(recordId, data, req) {
  const drs = await DeliveryRunSheet.findById(recordId);
  if (!drs) throw new NotFoundError("DRS not found", "DRS_NOT_FOUND");
  assertBranchAccess(drs, req.user);
  if (drs.status !== "OPEN") throw new ConflictError("Closed DRS cannot be changed", "DRS_CLOSED");
  const before = summary(drs);
  drs.vehicleNumber = data.vehicleNumber;
  if (data.partB) drs.partB = data.partB.map((row) => ({ ...row, updatedAt: new Date() }));
  await drs.save();
  await audit(null, req, "DRS_VEHICLE_UPDATED", "DeliveryRunSheet", drs._id, before, summary(drs));
  return dto(drs);
}
export async function uploadDrsPod(recordId, shipmentId, file, req) {
  if (!file) throw new BusinessRuleError("Choose a POD file", "FILE_REQUIRED");
  const drs = await DeliveryRunSheet.findById(recordId);
  if (!drs) throw new NotFoundError("DRS not found", "DRS_NOT_FOUND");
  assertBranchAccess(drs, req.user);
  if (drs.status !== "OPEN") throw new ConflictError("Closed DRS cannot accept POD", "DRS_CLOSED");
  if (!drs.shipmentIds.some((value) => id(value) === shipmentId))
    throw new BusinessRuleError("LR does not belong to this DRS", "INVALID_DRS_SHIPMENT");
  if (drs.podShipmentIds.some((value) => id(value) === shipmentId))
    throw new ConflictError("POD is already uploaded for this LR", "POD_ALREADY_UPLOADED");
  const stored = await storageService.saveDocument(shipmentId, "pod", file);
  try {
    const version = (await ShipmentDocument.countDocuments({ shipmentId, documentType: "POD" })) + 1;
    const document = await ShipmentDocument.create({
      shipmentId,
      documentType: "POD",
      version,
      ...stored,
      uploadedBy: req.user._id,
      uploadSource: "INTERNAL",
      verificationStatus: DOCUMENT_STATUS.VERIFIED,
      verifiedBy: req.user._id,
      verifiedAt: new Date(),
    });
    drs.podShipmentIds.addToSet(shipmentId);
    await drs.save();
    await audit(null, req, "DRS_POD_UPLOADED", "DeliveryRunSheet", drs._id, null, {
      drsNumber: drs.drsNumber,
      shipmentId,
      documentId: document._id,
    });
    return { drs: dto(drs), documentId: document._id };
  } catch (error) {
    await storageService.remove(stored.storageKey);
    throw error;
  }
}
export async function closeDrs(recordId, req) {
  const drs = await DeliveryRunSheet.findById(recordId);
  if (!drs) throw new NotFoundError("DRS not found", "DRS_NOT_FOUND");
  assertBranchAccess(drs, req.user);
  if (drs.status !== "OPEN") throw new ConflictError("DRS is not open", "DRS_NOT_OPEN");
  if (drs.podShipmentIds.length !== drs.shipmentIds.length)
    throw new ConflictError("Upload POD for every LR before closing the DRS", "POD_INCOMPLETE");
  const before = summary(drs);
  drs.status = "CLOSED";
  drs.closedAt = new Date();
  drs.closedBy = req.user._id;
  await drs.save();
  await audit(null, req, "DRS_CLOSED", "DeliveryRunSheet", drs._id, before, summary(drs));
  return dto(drs);
}

export async function createInvoice(data, req) {
  const branchId = branchFor(data, req);
  const session = await mongoose.startSession();
  try {
    let invoice;
    await session.withTransaction(async () => {
      const customer = await Customer.findById(data.customerId).session(session);
      if (!customer || customer.status !== ACTIVE.ACTIVE || customer.customerType !== "CREDIT")
        throw new BusinessRuleError(
          "Invoices can only be created for active credit customers",
          "CREDIT_CUSTOMER_REQUIRED",
        );
      const shipments = await assertShipments(
        data.shipmentIds,
        branchId,
        "originBranchId",
        [SHIPMENT_STATUS.COMPLETED, SHIPMENT_STATUS.CLOSED],
        session,
      );
      if (shipments.some((shipment) => id(shipment.customerId) !== id(data.customerId)))
        throw new BusinessRuleError(
          "All selected LRs must belong to the selected customer",
          "INVOICE_CUSTOMER_MISMATCH",
        );
      if (
        await Invoice.exists({ shipmentIds: { $in: data.shipmentIds }, status: { $ne: "CANCELLED" } }).session(session)
      )
        throw new ConflictError("A selected LR is already billed", "SHIPMENT_ALREADY_BILLED");
      const subtotal = money(
        shipments.reduce((sum, shipment) => {
          const details = shipment.lrDetails?.toObject?.() ?? shipment.lrDetails ?? {};
          return sum + Math.max(0, Number(details.totalAmount || 0) - Number(details.gstAmount || 0));
        }, 0),
      );
      if (subtotal <= 0)
        throw new BusinessRuleError("Selected LRs do not contain billable charges", "NO_BILLABLE_AMOUNT");
      const gstAmount = money((subtotal * data.gstRate) / 100);
      const totalAmount = money(subtotal + gstAmount);
      const customerData = customer.toObject();
      const billTo = {
        name: customerData.name,
        companyName: customerData.companyName,
        address: customerData.address,
        city: customerData.city,
        state: customerData.state,
        pincode: customerData.pincode,
        gstNumber: customerData.gstNumber,
        mobile: customerData.mobile,
        email: customerData.email,
      };
      const lineItems = shipments.map((shipment) => {
        const details = shipment.lrDetails?.toObject?.() ?? shipment.lrDetails ?? {};
        return {
          shipmentId: shipment._id,
          lrNumber: shipment.lrNumber,
          bookingDate: details.bookingDate || shipment.createdAt,
          origin: details.from,
          destination: details.to,
          packageCount: shipment.packageCount,
          weightKg: shipment.weightKg,
          taxableAmount: money(Math.max(0, Number(details.totalAmount || 0) - Number(details.gstAmount || 0))),
        };
      });
      invoice = (
        await Invoice.create(
          [
            {
              ...data,
              branchId,
              billTo,
              lineItems,
              subtotal,
              gstAmount,
              totalAmount,
              balanceAmount: totalAmount,
              invoiceNumber: await generateBusinessNumber("invoice", "INV", session),
              createdBy: req.user._id,
            },
          ],
          { session },
        )
      )[0];
      await audit(session, req, "INVOICE_CREATED", "Invoice", invoice._id, null, summary(invoice));
    });
    return dto(invoice);
  } finally {
    await session.endSession();
  }
}
export const listInvoices = (query, user) =>
  list(Invoice, query, user, {
    search: ["invoiceNumber", "notes"],
    populate: ["customerId", "branchId"],
  });
export const getInvoice = (recordId, user) => get(Invoice, recordId, user, ["customerId", "branchId", "shipmentIds"]);
export async function updateInvoiceStatus(recordId, data, req) {
  const invoice = await Invoice.findById(recordId);
  if (!invoice) throw new NotFoundError("Invoice not found", "INVOICE_NOT_FOUND");
  assertBranchAccess(invoice, req.user);
  if (data.status === "ISSUED" && invoice.status !== "DRAFT")
    throw new ConflictError("Only draft invoices can be issued", "INVALID_INVOICE_STATUS");
  if (data.status === "CANCELLED" && (invoice.paidAmount > 0 || !["DRAFT", "ISSUED"].includes(invoice.status)))
    throw new ConflictError("Paid invoices cannot be cancelled", "INVOICE_HAS_RECEIPTS");
  const before = summary(invoice);
  invoice.status = data.status;
  if (data.notes) invoice.notes = data.notes;
  await invoice.save();
  await audit(null, req, "INVOICE_STATUS_UPDATED", "Invoice", invoice._id, before, summary(invoice));
  return dto(invoice);
}

export async function createMoneyReceipt(data, req) {
  const branchId = branchFor(data, req);
  const allocationTotal = money(data.allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  if (data.allocations.length && allocationTotal !== money(data.amount))
    throw new BusinessRuleError("Receipt allocations must equal the received amount", "ALLOCATION_TOTAL_MISMATCH");
  const session = await mongoose.startSession();
  try {
    let receipt;
    await session.withTransaction(async () => {
      if (!(await Customer.exists({ _id: data.customerId, status: ACTIVE.ACTIVE }).session(session)))
        throw new BusinessRuleError("Select an active customer", "INVALID_CUSTOMER");
      for (const allocation of data.allocations) {
        const invoice = await Invoice.findById(allocation.invoiceId).session(session);
        if (!invoice || id(invoice.customerId) !== id(data.customerId) || id(invoice.branchId) !== id(branchId))
          throw new BusinessRuleError("Invalid invoice allocation", "INVALID_INVOICE_ALLOCATION");
        if (!["ISSUED", "PART_PAID"].includes(invoice.status) || allocation.amount > invoice.balanceAmount)
          throw new ConflictError("Allocation exceeds invoice outstanding", "ALLOCATION_EXCEEDS_BALANCE");
        invoice.paidAmount = money(invoice.paidAmount + allocation.amount);
        invoice.balanceAmount = money(invoice.totalAmount - invoice.paidAmount);
        invoice.status = invoice.balanceAmount === 0 ? "PAID" : "PART_PAID";
        await invoice.save({ session });
      }
      receipt = (
        await MoneyReceipt.create(
          [
            {
              ...data,
              branchId,
              receiptNumber: await generateBusinessNumber("receipt", "RCPT", session),
              createdBy: req.user._id,
            },
          ],
          { session },
        )
      )[0];
      await audit(session, req, "MONEY_RECEIPT_CREATED", "MoneyReceipt", receipt._id, null, summary(receipt));
    });
    return dto(receipt);
  } finally {
    await session.endSession();
  }
}
export const listMoneyReceipts = (query, user) =>
  list(MoneyReceipt, query, user, {
    search: ["receiptNumber", "receivedFrom", "transactionReference"],
    populate: ["customerId", "branchId"],
  });
export const getMoneyReceipt = (recordId, user) =>
  get(MoneyReceipt, recordId, user, ["customerId", "branchId", "allocations.invoiceId"]);

const quotationTotal = (freight, gstRate) => money(Number(freight || 0) * (1 + Number(gstRate || 0) / 100));
export async function createQuotation(data, req) {
  const branchId = branchFor(data, req);
  const quotation = await Quotation.create({
    ...data,
    branchId,
    quotationNumber: await generateBusinessNumber("quotation", "QUO"),
    totalAmount: quotationTotal(data.estimatedFreight, data.gstRate),
    status: data.estimatedFreight > 0 ? "QUOTED" : "REQUESTED",
    source: "INTERNAL",
    createdBy: req.user._id,
  });
  await audit(null, req, "QUOTATION_CREATED", "Quotation", quotation._id, null, summary(quotation));
  return dto(quotation);
}
export async function createPublicQuotation(data) {
  const quotation = await Quotation.create({
    ...data,
    quotationNumber: await generateBusinessNumber("quotation", "QUO"),
    source: "PUBLIC",
    status: "REQUESTED",
  });
  return { quotationNumber: quotation.quotationNumber, status: quotation.status };
}
export const listQuotations = (query, user) =>
  list(Quotation, query, user, {
    search: ["quotationNumber", "leadName", "companyName", "mobile", "origin", "destination"],
    populate: ["customerId", "branchId"],
  });
export const getQuotation = (recordId, user) => get(Quotation, recordId, user, ["customerId", "branchId"], false);
export async function updateQuotationStatus(recordId, data, req) {
  const quotation = await Quotation.findById(recordId);
  if (!quotation) throw new NotFoundError("Quotation not found", "QUOTATION_NOT_FOUND");
  if (quotation.branchId) assertBranchAccess(quotation, req.user);
  if (!quotation.branchId && !isAdmin(req.user)) quotation.branchId = req.user.branchId;
  const before = summary(quotation);
  Object.assign(quotation, data);
  quotation.totalAmount = quotationTotal(quotation.estimatedFreight, quotation.gstRate);
  await quotation.save();
  await audit(null, req, "QUOTATION_STATUS_UPDATED", "Quotation", quotation._id, before, summary(quotation));
  return dto(quotation);
}

async function availableStationery(branchId, itemType, session) {
  const [result] = await StationeryTransaction.aggregate([
    { $match: { branchId: new mongoose.Types.ObjectId(branchId), itemType } },
    {
      $group: {
        _id: null,
        received: { $sum: { $cond: [{ $eq: ["$transactionType", "RECEIVE"] }, "$quantity", 0] } },
        issued: { $sum: { $cond: [{ $eq: ["$transactionType", "ISSUE"] }, "$quantity", 0] } },
      },
    },
  ]).session(session);
  return Number(result?.received || 0) - Number(result?.issued || 0);
}
export async function createStationeryTransaction(data, req) {
  const branchId = branchFor(data, req);
  const session = await mongoose.startSession();
  try {
    let transaction;
    await session.withTransaction(async () => {
      if (
        data.transactionType === "ISSUE" &&
        (await availableStationery(branchId, data.itemType, session)) < data.quantity
      )
        throw new ConflictError("Insufficient stationery stock", "INSUFFICIENT_STOCK");
      transaction = (
        await StationeryTransaction.create(
          [
            {
              ...data,
              branchId,
              transactionNumber: await generateBusinessNumber("stationery", "STN", session),
              createdBy: req.user._id,
            },
          ],
          { session },
        )
      )[0];
      await audit(
        session,
        req,
        "STATIONERY_TRANSACTION_CREATED",
        "StationeryTransaction",
        transaction._id,
        null,
        summary(transaction),
      );
    });
    return dto(transaction);
  } finally {
    await session.endSession();
  }
}
export const listStationery = (query, user) =>
  list(StationeryTransaction, query, user, {
    search: ["transactionNumber", "itemType", "issuedToName", "serialFrom", "serialTo"],
    populate: ["branchId", "vendorId", "userId"],
  });
export async function stationeryStock(query, user) {
  const match = scope(query, user);
  const rows = await StationeryTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { branchId: "$branchId", itemType: "$itemType" },
        received: { $sum: { $cond: [{ $eq: ["$transactionType", "RECEIVE"] }, "$quantity", 0] } },
        issued: { $sum: { $cond: [{ $eq: ["$transactionType", "ISSUE"] }, "$quantity", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        branchId: "$_id.branchId",
        itemType: "$_id.itemType",
        received: 1,
        issued: 1,
        available: { $subtract: ["$received", "$issued"] },
      },
    },
    { $sort: { itemType: 1 } },
  ]);
  return rows;
}

export async function receivablesSummary(query, user) {
  const filter = { ...scope(query, user), status: { $in: ["ISSUED", "PART_PAID"] } };
  if (query.customerId) filter.customerId = query.customerId;
  const [totals] = await Invoice.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        invoiceCount: { $sum: 1 },
        billed: { $sum: "$totalAmount" },
        received: { $sum: "$paidAmount" },
        outstanding: { $sum: "$balanceAmount" },
        overdue: { $sum: { $cond: [{ $lt: ["$dueDate", new Date()] }, "$balanceAmount", 0] } },
      },
    },
  ]);
  return totals || { invoiceCount: 0, billed: 0, received: 0, outstanding: 0, overdue: 0 };
}
