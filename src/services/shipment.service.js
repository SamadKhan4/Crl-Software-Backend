import crypto from "node:crypto";
import mongoose from "mongoose";
import { ACTIVE, DOCUMENT_STATUS, ROLES, SHIPMENT_STATUS, TRANSITIONS } from "../constants/workflow.js";
import { Branch, Customer, Shipment, ShipmentDocument, ShipmentEvent, UploadSession } from "../models/index.js";
import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError } from "../utils/errors.js";
import { calculateGoods } from "../utils/goods.js";
import { calculateCharges } from "../utils/charges.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";
import { storageService } from "./storage.service.js";
import { env } from "../config/env.js";

const isAdmin = (user) => user?.role === ROLES.ADMIN;
const getShipment = async (id, session) => {
  const shipment = await Shipment.findById(id).session(session);
  if (!shipment) throw new NotFoundError("Shipment not found", "SHIPMENT_NOT_FOUND");
  return shipment;
};
const assertBranch = (user, branchId, message = "You are not authorized for this branch operation") => {
  if (!isAdmin(user) && user?.branchId?.toString() !== (branchId?._id ?? branchId)?.toString())
    throw new AuthorizationError(message);
};
const assertShipmentBranchAccess = (user, shipment, operation) => {
  if (isAdmin(user)) return;
  const branchId = operation === "origin" ? shipment.originBranchId : shipment.destinationBranchId;
  assertBranch(user, branchId);
};
const assertTransition = (from, to) => {
  if (!TRANSITIONS[from]?.includes(to))
    throw new ConflictError("Invalid shipment status transition", "INVALID_STATUS_TRANSITION");
};
const eventDto = (event) => ({
  id: event._id,
  status: event.status,
  location: event.location,
  branchId: event.branchId,
  remarks: event.remarks,
  timestamp: event.createdAt,
});
const documentDto = (document) => ({
  id: document._id,
  documentType: document.documentType,
  version: document.version,
  originalFileName: document.originalFileName,
  mimeType: document.mimeType,
  fileSize: document.fileSize,
  checksum: document.checksum,
  uploadSource: document.uploadSource,
  verificationStatus: document.verificationStatus,
  uploadedBy: document.uploadedBy,
  createdAt: document.createdAt,
  verifiedBy: document.verifiedBy,
  verifiedAt: document.verifiedAt,
  rejectionReason: document.rejectionReason,
});
const shipmentDto = (shipment) => ({ ...(shipment.toObject?.() ?? shipment), id: shipment._id });
const canonicalValue = (value) => {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value?.toHexString) return value.toHexString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) => {
          const normalized = canonicalValue(value[key]);
          return normalized === undefined ? [] : [[key, normalized]];
        }),
    );
  return value;
};
const matchesCreatePayload = (shipment, data) => {
  const prior = shipment.toObject?.() ?? shipment;
  const savedPayload = Object.fromEntries(Object.keys(data).map((key) => [key, prior[key]]));
  return JSON.stringify(canonicalValue(savedPayload)) === JSON.stringify(canonicalValue(data));
};
const lrDetailsAuditSummary = (lrDetails) => ({
  fields: Object.keys(lrDetails?.toObject?.() ?? lrDetails ?? {}).sort(),
});
const mergeLrDetails = (shipment, lrDetails) => ({
  ...(shipment.lrDetails?.toObject?.() ?? shipment.lrDetails ?? {}),
  ...lrDetails,
});
const applyLrCalculations = (data) => {
  if (!data.lrDetails) return data;
  const details = data.lrDetails.toObject?.() ?? data.lrDetails;
  if (details.goods?.length) {
    const { packageCount, ...totals } = calculateGoods(details.goods);
    data.packageCount = packageCount;
    data.weightKg = totals.actualWeight;
    Object.assign(details, totals);
  }
  data.lrDetails = { ...details, ...calculateCharges(details) };
  return data;
};
const applyCustomerCharges = (data, customer) => {
  if (customer.customerType !== "CREDIT" || !customer.creditCharges) return data;
  const rates = customer.creditCharges.toObject?.() ?? customer.creditCharges;
  const details = data.lrDetails?.toObject?.() ?? data.lrDetails ?? {};
  const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const freightUnits = rates.freightBasis === "PER_BOX" ? data.packageCount : details.chargedWeight ?? data.weightKg;
  const freightCharges = money(Number(rates.freightRate || 0) * Number(freightUnits || 0));
  data.lrDetails = {
    ...details,
    freightCharges,
    fuelCharges: money(freightCharges * Number(rates.fuelRatePercent || 0) / 100),
    handlingCharges: rates.handlingCharges,
    fodCharges: rates.fodCharges,
    codCharges: rates.codCharges,
    rovCharges: money(Number(details.declaredValue || 0) * Number(rates.rovRatePercent || 0) / 100),
    docketCharges: rates.docketCharges,
    gstRate: rates.gstRate,
    paymentMode: "CREDIT",
  };
  return applyLrCalculations(data);
};
const createEvent = async (session, shipment, status, location, branchId, remarks, updatedBy) =>
  ShipmentEvent.create([{ shipmentId: shipment._id, status, location, branchId, remarks, updatedBy }], { session });
const applyStatus = async (session, shipment, targetStatus, { location, branchId, remarks, updatedBy }) => {
  assertTransition(shipment.currentStatus, targetStatus);
  const previousStatus = shipment.currentStatus;
  shipment.currentStatus = targetStatus;
  shipment.currentLocation = location;
  await createEvent(session, shipment, targetStatus, location, branchId, remarks, updatedBy);
  return previousStatus;
};
const activeEntities = async (data, session) => {
  const [customer, origin, destination] = await Promise.all([
    Customer.findOne({ _id: data.customerId, status: ACTIVE.ACTIVE }).session(session),
    Branch.findOne({ _id: data.originBranchId, status: ACTIVE.ACTIVE }).session(session),
    Branch.findOne({ _id: data.destinationBranchId, status: ACTIVE.ACTIVE }).session(session),
  ]);
  if (!customer) throw new ConflictError("Customer is invalid or inactive", "INVALID_CUSTOMER");
  if (!origin || !destination)
    throw new ConflictError("Origin and destination must be active branches", "INVALID_BRANCH");
  return { customer, origin, destination };
};

export async function createShipment(data, req, idempotencyKey) {
  data = applyLrCalculations(data);
  const pricingCustomer = await Customer.findOne({ _id: data.customerId, status: ACTIVE.ACTIVE });
  if (!pricingCustomer) throw new ConflictError("Customer is invalid or inactive", "INVALID_CUSTOMER");
  data = applyCustomerCharges(data, pricingCustomer);
  if (idempotencyKey) {
    const prior = await Shipment.findOne({ idempotencyKey });
    if (prior) {
      assertShipmentBranchAccess(req.user, prior, "origin");
      if (String(prior.createdBy) !== String(req.user._id))
        throw new ConflictError("Idempotency key belongs to another request", "IDEMPOTENCY_KEY_CONFLICT");
      if (!matchesCreatePayload(prior, data))
        throw new ConflictError("Idempotency key was already used with different data", "IDEMPOTENCY_KEY_CONFLICT");
      return { shipment: shipmentDto(prior), replayed: true };
    }
  }
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      const { origin } = await activeEntities(data, session);
      assertBranch(req.user, origin._id, "Employees can create shipments only from their assigned origin branch");
      shipment = (
        await Shipment.create(
          [
            {
              ...data,
              idempotencyKey,
              currentLocation: origin.name,
              createdBy: req.user._id,
            },
          ],
          { session },
        )
      )[0];
      await createEvent(
        session,
        shipment,
        SHIPMENT_STATUS.BOOKED,
        origin.name,
        origin._id,
        "Shipment booked",
        req.user._id,
      );
      await audit(session, req, "SHIPMENT_CREATED", "Shipment", shipment._id, null, {
        lrNumber: shipment.lrNumber,
        status: shipment.currentStatus,
        hasLrDetails: Boolean(shipment.lrDetails),
        ...(shipment.lrDetails && { lrDetails: lrDetailsAuditSummary(shipment.lrDetails) }),
      });
    });
    return { shipment: shipmentDto(shipment), replayed: false };
  } catch (error) {
    if (error.code === 11000 && idempotencyKey) {
      const prior = await Shipment.findOne({ idempotencyKey });
      if (prior) {
        assertShipmentBranchAccess(req.user, prior, "origin");
        if (String(prior.createdBy) !== String(req.user._id))
          throw new ConflictError("Idempotency key belongs to another request", "IDEMPOTENCY_KEY_CONFLICT");
        if (!matchesCreatePayload(prior, data))
          throw new ConflictError("Idempotency key was already used with different data", "IDEMPOTENCY_KEY_CONFLICT");
        return { shipment: shipmentDto(prior), replayed: true };
      }
    }
    if (error.code === 11000) throw new ConflictError("LR number already exists", "LR_NUMBER_EXISTS");
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function listShipments(query, user) {
  const options = listQuery(query);
  const filter = {};
  if (!isAdmin(user)) {
    if (!user.branchId) return paginated([], 0, options);
    filter.$or = [{ originBranchId: user.branchId }, { destinationBranchId: user.branchId }];
  }
  const criteria = [];
  if (query.search)
    criteria.push({
      $or: ["lrNumber", "senderName", "receiverName"].map((field) => ({
        [field]: { $regex: escapeSearch(query.search), $options: "i" },
      })),
    });
  if (query.lrNumber) criteria.push({ lrNumber: query.lrNumber.toUpperCase() });
  if (query.status) criteria.push({ currentStatus: query.status });
  for (const field of ["customerId", "originBranchId", "destinationBranchId"])
    if (query[field]) criteria.push({ [field]: query[field] });
  if (query.dateFrom || query.dateTo)
    criteria.push({
      createdAt: { ...(query.dateFrom && { $gte: query.dateFrom }), ...(query.dateTo && { $lte: query.dateTo }) },
    });
  if (criteria.length) filter.$and = criteria;
  const [items, total] = await Promise.all([
    Shipment.find(filter)
      .select(
        "lrNumber customerId originBranchId destinationBranchId currentStatus currentLocation senderName receiverName packageCount weightKg expectedDeliveryDate createdAt",
      )
      .populate("customerId", "customerCode name companyName")
      .populate("originBranchId destinationBranchId", "branchCode name city")
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean(),
    Shipment.countDocuments(filter),
  ]);
  return paginated(items, total, options);
}

export async function shipmentDetails(id, user) {
  const shipment = await Shipment.findById(id)
    .populate("customerId", "customerCode name companyName mobile email")
    .populate("originBranchId destinationBranchId receivingBranchId", "branchCode name city")
    .lean();
  if (!shipment) throw new NotFoundError("Shipment not found", "SHIPMENT_NOT_FOUND");
  assertShipmentBranchAccess(
    user,
    shipment,
    (shipment.destinationBranchId?._id ?? shipment.destinationBranchId)?.toString() === user?.branchId?.toString()
      ? "destination"
      : "origin",
  );
  const documents = await ShipmentDocument.find({ shipmentId: id }).sort({ documentType: 1, version: -1 }).lean();
  return { ...shipment, id: shipment._id, documents: documents.map(documentDto) };
}

export async function shipmentHistory(id, user) {
  const shipment = await getShipment(id);
  assertShipmentBranchAccess(
    user,
    shipment,
    (shipment.destinationBranchId?._id ?? shipment.destinationBranchId)?.toString() === user?.branchId?.toString()
      ? "destination"
      : "origin",
  );
  const events = await ShipmentEvent.find({ shipmentId: id }).sort({ createdAt: 1 }).lean();
  return events.map(eventDto);
}

export async function openDocument(id, documentId, user) {
  const shipment = await getShipment(id);
  assertShipmentBranchAccess(
    user,
    shipment,
    (shipment.destinationBranchId?._id ?? shipment.destinationBranchId)?.toString() === user?.branchId?.toString()
      ? "destination"
      : "origin",
  );
  const document = await ShipmentDocument.findOne({ _id: documentId, shipmentId: id }).select("+storageKey +fileUrl");
  if (!document) throw new NotFoundError("Document not found", "DOCUMENT_NOT_FOUND");
  const source = await storageService.open(document.storageKey, document.fileUrl);
  return { ...source, originalFileName: document.originalFileName, mimeType: document.mimeType };
}

export async function updateShipment(id, data, req) {
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await getShipment(id, session);
      assertShipmentBranchAccess(req.user, shipment, "origin");
      if (shipment.currentStatus !== SHIPMENT_STATUS.BOOKED)
        throw new ConflictError("Shipment can only be edited while booked", "SHIPMENT_NOT_EDITABLE");
      const before = shipmentDto(shipment);
      const existingLrDetails = shipment.lrDetails;
      Object.assign(shipment, data);
      if (data.lrDetails) shipment.lrDetails = mergeLrDetails({ lrDetails: existingLrDetails }, data.lrDetails);
      applyLrCalculations(shipment);
      await shipment.save({ session });
      const { lrDetails, ...beforeWithoutLrDetails } = before;
      const { lrDetails: updatedLrDetails, ...afterWithoutLrDetails } = shipmentDto(shipment);
      if (Object.keys(data).some((key) => key !== "lrDetails"))
        await audit(session, req, "SHIPMENT_UPDATED", "Shipment", id, beforeWithoutLrDetails, afterWithoutLrDetails);
      if (data.lrDetails)
        await audit(
          session,
          req,
          "LR_DETAILS_UPDATED",
          "Shipment",
          id,
          lrDetailsAuditSummary(lrDetails),
          lrDetailsAuditSummary(updatedLrDetails),
        );
    });
    return shipmentDto(shipment);
  } finally {
    await session.endSession();
  }
}

export async function adminOverride(id, data, req) {
  if (!isAdmin(req.user)) throw new AuthorizationError();
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await getShipment(id, session);
      const before = shipmentDto(shipment);
      const existingLrDetails = shipment.lrDetails;
      Object.assign(shipment, data.changes);
      if (data.changes.lrDetails)
        shipment.lrDetails = mergeLrDetails({ lrDetails: existingLrDetails }, data.changes.lrDetails);
      applyLrCalculations(shipment);
      await shipment.save({ session });
      await createEvent(
        session,
        shipment,
        shipment.currentStatus,
        shipment.currentLocation || "Operations",
        shipment.destinationBranchId,
        `Admin override: ${data.reason}`,
        req.user._id,
      );
      const { lrDetails, ...changesWithoutLrDetails } = data.changes;
      const { lrDetails: beforeLrDetails, ...beforeWithoutLrDetails } = before;
      await audit(session, req, "ADMIN_OVERRIDE", "Shipment", id, beforeWithoutLrDetails, {
        changes: changesWithoutLrDetails,
        ...(lrDetails && { lrDetails: lrDetailsAuditSummary(lrDetails) }),
        reason: data.reason,
      });
      if (lrDetails)
        await audit(
          session,
          req,
          "LR_DETAILS_UPDATED",
          "Shipment",
          id,
          lrDetailsAuditSummary(beforeLrDetails),
          lrDetailsAuditSummary(shipment.lrDetails),
        );
    });
    return shipmentDto(shipment);
  } finally {
    await session.endSession();
  }
}

export async function transition(id, target, data, req, action = "SHIPMENT_STATUS_CHANGED") {
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await getShipment(id, session);
      const branchOperation =
        target === SHIPMENT_STATUS.IN_TRANSIT || target === SHIPMENT_STATUS.CANCELLED ? "origin" : "destination";
      assertShipmentBranchAccess(req.user, shipment, branchOperation);
      const beforeStatus = await applyStatus(session, shipment, target, {
        location: data.location,
        branchId: branchOperation === "origin" ? shipment.originBranchId : shipment.destinationBranchId,
        remarks: data.remarks,
        updatedBy: req.user._id,
      });
      await shipment.save({ session });
      await audit(
        session,
        req,
        action,
        "Shipment",
        id,
        { status: beforeStatus },
        { status: target, location: data.location, remarks: data.remarks },
      );
    });
    return shipmentDto(shipment);
  } finally {
    await session.endSession();
  }
}

export async function receive(id, data, req) {
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await getShipment(id, session);
      assertShipmentBranchAccess(req.user, shipment, "destination");
      const beforeStatus = await applyStatus(session, shipment, SHIPMENT_STATUS.RECEIVED, {
        location: data.location,
        branchId: shipment.destinationBranchId,
        remarks: data.remarks,
        updatedBy: req.user._id,
      });
      shipment.receivedAt = new Date();
      shipment.receivedBy = req.user._id;
      shipment.receivedLocation = data.location;
      shipment.receivingBranchId = shipment.destinationBranchId;
      await shipment.save({ session });
      await audit(
        session,
        req,
        "SHIPMENT_RECEIVED",
        "Shipment",
        id,
        { status: beforeStatus },
        { status: SHIPMENT_STATUS.RECEIVED, location: data.location },
      );
    });
    return shipmentDto(shipment);
  } finally {
    await session.endSession();
  }
}

const saveDocument = async (shipment, stored, source, userId, session) => {
  const version =
    (await ShipmentDocument.countDocuments({ shipmentId: shipment._id, documentType: "LR_IMAGE" }).session(session)) +
    1;
  return (
    await ShipmentDocument.create(
      [
        {
          shipmentId: shipment._id,
          documentType: "LR_IMAGE",
          version,
          ...stored,
          uploadedBy: userId,
          uploadSource: source,
        },
      ],
      { session },
    )
  )[0];
};
const uploadDocument = async (id, file, req, source, tokenHash) => {
  const stored = await storageService.saveLRDocument(id, file);
  const session = await mongoose.startSession();
  try {
    let document;
    await session.withTransaction(async () => {
      const shipment = await getShipment(id, session);
      if (source === "INTERNAL") assertShipmentBranchAccess(req.user, shipment, "destination");
      if (source === "CUSTOMER") {
        const uploadSession = await UploadSession.findOneAndUpdate(
          { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
          { usedAt: new Date(), $inc: { attemptCount: 1 } },
          { new: true, session },
        );
        if (!uploadSession || uploadSession.shipmentId.toString() !== id.toString())
          throw new AuthenticationError("Upload token is invalid, expired, or already used", "INVALID_UPLOAD_TOKEN");
      }
      if (shipment.currentStatus !== SHIPMENT_STATUS.RECEIVED)
        throw new ConflictError(
          "LR image can only be uploaded after shipment is received",
          "INVALID_DOCUMENT_WORKFLOW",
        );
      document = await saveDocument(shipment, stored, source, req.user?._id, session);
      await applyStatus(session, shipment, SHIPMENT_STATUS.LR_IMAGE_UPLOADED, {
        location: shipment.currentLocation || "Receiving branch",
        branchId: shipment.destinationBranchId,
        remarks: "LR document uploaded",
        updatedBy: req.user?._id,
      });
      await shipment.save({ session });
      await audit(session, req, "DOCUMENT_UPLOADED", "ShipmentDocument", document._id, null, {
        shipmentId: id,
        version: document.version,
        source,
      });
    });
    return documentDto(document);
  } catch (error) {
    await storageService.remove(stored.storageKey);
    throw error;
  } finally {
    await session.endSession();
  }
};

export const uploadLR = (id, file, req) => uploadDocument(id, file, req, "INTERNAL");

export async function verifyLR(id, data, req) {
  const session = await mongoose.startSession();
  try {
    let document;
    await session.withTransaction(async () => {
      const shipment = await getShipment(id, session);
      if (![ROLES.ADMIN, ROLES.MANAGER].includes(req.user.role))
        throw new AuthorizationError("Only administrators and destination managers can verify LR documents");
      assertShipmentBranchAccess(req.user, shipment, "destination");
      if (shipment.currentStatus !== SHIPMENT_STATUS.LR_IMAGE_UPLOADED)
        throw new ConflictError("No LR image is awaiting verification", "INVALID_DOCUMENT_WORKFLOW");
      document = await ShipmentDocument.findOne({
        shipmentId: id,
        documentType: "LR_IMAGE",
        verificationStatus: DOCUMENT_STATUS.PENDING,
      }).session(session);
      if (!document) throw new NotFoundError("Pending LR image not found", "DOCUMENT_NOT_FOUND");
      document.verificationStatus = data.status;
      document.verifiedBy = req.user._id;
      document.verifiedAt = new Date();
      document.rejectionReason = data.status === DOCUMENT_STATUS.REJECTED ? data.remarks : undefined;
      await document.save({ session });
      const target =
        data.status === DOCUMENT_STATUS.VERIFIED ? SHIPMENT_STATUS.LR_IMAGE_VERIFIED : SHIPMENT_STATUS.RECEIVED;
      await applyStatus(session, shipment, target, {
        location: shipment.currentLocation || "Receiving branch",
        branchId: shipment.destinationBranchId,
        remarks: data.remarks,
        updatedBy: req.user._id,
      });
      await shipment.save({ session });
      await audit(
        session,
        req,
        data.status === DOCUMENT_STATUS.VERIFIED ? "DOCUMENT_VERIFIED" : "DOCUMENT_REJECTED",
        "ShipmentDocument",
        document._id,
        null,
        { status: data.status, shipmentStatus: target },
      );
    });
    return documentDto(document);
  } finally {
    await session.endSession();
  }
}

export async function complete(id, req) {
  const shipment = await getShipment(id);
  assertShipmentBranchAccess(req.user, shipment, "destination");
  return transition(
    id,
    SHIPMENT_STATUS.COMPLETED,
    { location: shipment.currentLocation || "Operations", remarks: "Shipment completed" },
    req,
    "SHIPMENT_COMPLETED",
  );
}

export async function close(id, req) {
  if (![ROLES.ADMIN, ROLES.MANAGER].includes(req.user.role))
    throw new AuthorizationError("Only administrators and destination managers can close shipments");
  const session = await mongoose.startSession();
  try {
    let shipment;
    await session.withTransaction(async () => {
      shipment = await getShipment(id, session);
      assertShipmentBranchAccess(req.user, shipment, "destination");
      const verified = await ShipmentDocument.exists({
        shipmentId: id,
        documentType: "LR_IMAGE",
        verificationStatus: DOCUMENT_STATUS.VERIFIED,
      }).session(session);
      if (!shipment.receivedAt || !verified)
        throw new ConflictError(
          "Shipment cannot be closed until its LR document is verified",
          "CLOSING_CONDITIONS_UNMET",
        );
      const beforeStatus = await applyStatus(session, shipment, SHIPMENT_STATUS.CLOSED, {
        location: shipment.currentLocation || "Operations",
        branchId: shipment.destinationBranchId,
        remarks: "Shipment closed",
        updatedBy: req.user._id,
      });
      await shipment.save({ session });
      await audit(
        session,
        req,
        "SHIPMENT_CLOSED",
        "Shipment",
        id,
        { status: beforeStatus },
        { status: SHIPMENT_STATUS.CLOSED },
      );
    });
    return shipmentDto(shipment);
  } finally {
    await session.endSession();
  }
}

const createUploadSession = async (shipment, req) => {
  if (shipment.currentStatus !== SHIPMENT_STATUS.RECEIVED)
    throw new ConflictError("Shipment is not eligible for LR document upload", "INVALID_DOCUMENT_WORKFLOW");
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await UploadSession.updateMany(
        { shipmentId: shipment._id, usedAt: null },
        { expiresAt: new Date() },
        { session },
      );
      await UploadSession.create(
        [
          {
            shipmentId: shipment._id,
            tokenHash,
            expiresAt: new Date(Date.now() + env.uploadTokenMinutes * 60000),
            createdBy: req.user?._id,
          },
        ],
        { session },
      );
      await audit(session, req, "UPLOAD_TOKEN_CREATED", "Shipment", shipment._id, null, {
        expiresInMinutes: env.uploadTokenMinutes,
      });
    });
    return rawToken;
  } finally {
    await session.endSession();
  }
};

export async function createInternalUploadSession(id, req) {
  const shipment = await getShipment(id);
  assertShipmentBranchAccess(req.user, shipment, "destination");
  return createUploadSession(shipment, req);
}

export async function requestPublicUploadSession(data, req) {
  const shipment = await Shipment.findOne({ lrNumber: data.lrNumber }).populate({
    path: "customerId",
    match: { customerCode: data.customerCode, status: ACTIVE.ACTIVE },
  });
  if (!shipment?.customerId || shipment.currentStatus !== SHIPMENT_STATUS.RECEIVED) return { accepted: true };
  return { accepted: true, uploadToken: await createUploadSession(shipment, req) };
}

export async function uploadPublicLR(token, file, req) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await UploadSession.findOne({ tokenHash, usedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!session)
    throw new AuthenticationError("Upload token is invalid, expired, or already used", "INVALID_UPLOAD_TOKEN");
  return uploadDocument(session.shipmentId, file, req, "CUSTOMER", tokenHash);
}

export async function publicTrack(lrNumber) {
  const shipment = await Shipment.findOne({ lrNumber: lrNumber.toUpperCase() })
    .populate("originBranchId destinationBranchId", "city name")
    .lean();
  if (!shipment) throw new NotFoundError("No shipment found for this LR number", "SHIPMENT_NOT_FOUND");
  const events = await ShipmentEvent.find({ shipmentId: shipment._id })
    .sort({ createdAt: 1 })
    .select("status location createdAt")
    .lean();
  return {
    lrNumber: shipment.lrNumber,
    origin: shipment.originBranchId?.city,
    destination: shipment.destinationBranchId?.city,
    status: shipment.currentStatus,
    currentLocation: shipment.currentLocation,
    bookingDate: shipment.createdAt,
    expectedDeliveryDate: shipment.expectedDeliveryDate,
    trackingHistory: events.map(eventDto),
  };
}
