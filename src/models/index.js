import mongoose from "mongoose";
import { ACTIVE, DOCUMENT_STATUS, ROLES, SHIPMENT_STATUS } from "../constants/workflow.js";

const { Schema, model } = mongoose;
const base = { timestamps: true, versionKey: false };
const objectId = { type: Schema.Types.ObjectId };

export const Counter = model(
  "Counter",
  new Schema(
    { key: { type: String, required: true, unique: true }, value: { type: Number, required: true, default: 0 } },
    base,
  ),
);

export const User = model(
  "User",
  new Schema(
    {
      employeeCode: { type: String, required: true, unique: true, uppercase: true, index: true },
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
      mobile: { type: String, trim: true },
      passwordHash: { type: String, required: true, select: false },
      role: { type: String, enum: Object.values(ROLES), default: ROLES.EMPLOYEE },
      branchId: { ...objectId, ref: "Branch", index: true },
      status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE, index: true },
      lastLoginAt: Date,
    },
    base,
  ),
);

export const RefreshToken = model(
  "RefreshToken",
  new Schema(
    {
      userId: { ...objectId, ref: "User", required: true, index: true },
      familyId: { type: String, required: true, index: true },
      tokenHash: { type: String, required: true, unique: true },
      expiresAt: { type: Date, required: true, index: { expires: 0 } },
      revokedAt: Date,
      replacedAt: Date,
    },
    base,
  ),
);

export const Branch = model(
  "Branch",
  new Schema(
    {
      branchCode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
      name: { type: String, required: true, trim: true, index: true },
      address: { type: String, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, lowercase: true, trim: true },
      status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE, index: true },
    },
    base,
  ),
);

export const Customer = model(
  "Customer",
  new Schema(
    {
      customerCode: { type: String, required: true, unique: true, uppercase: true, index: true },
      name: { type: String, required: true, trim: true, index: true },
      companyName: { type: String, trim: true, index: true },
      mobile: { type: String, required: true, trim: true, index: true },
      alternateMobile: { type: String, trim: true },
      email: { type: String, lowercase: true, trim: true, index: true },
      address: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      gstNumber: { type: String, uppercase: true, trim: true, sparse: true, index: true },
      status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE, index: true },
      createdBy: { ...objectId, ref: "User", required: true },
    },
    base,
  ),
);

export const Shipment = model(
  "Shipment",
  new Schema(
    {
      lrNumber: { type: String, required: true, unique: true, uppercase: true, index: true },
      idempotencyKey: { type: String, sparse: true, unique: true, index: true },
      customerId: { ...objectId, ref: "Customer", required: true, index: true },
      originBranchId: { ...objectId, ref: "Branch", required: true, index: true },
      destinationBranchId: { ...objectId, ref: "Branch", required: true, index: true },
      currentStatus: {
        type: String,
        enum: Object.values(SHIPMENT_STATUS),
        default: SHIPMENT_STATUS.BOOKED,
        index: true,
      },
      currentLocation: { type: String, trim: true },
      senderName: { type: String, required: true, trim: true },
      receiverName: { type: String, required: true, trim: true },
      receiverMobile: { type: String, trim: true },
      packageCount: { type: Number, required: true, min: 1 },
      weightKg: { type: Number, required: true, min: 0.01 },
      description: { type: String, trim: true },
      expectedDeliveryDate: Date,
      receivedAt: Date,
      receivedBy: { ...objectId, ref: "User" },
      receivedLocation: String,
      receivingBranchId: { ...objectId, ref: "Branch" },
      createdBy: { ...objectId, ref: "User", required: true },
    },
    base,
  ),
);

export const ShipmentEvent = model(
  "ShipmentEvent",
  new Schema(
    {
      shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
      status: { type: String, enum: Object.values(SHIPMENT_STATUS), required: true, index: true },
      location: { type: String, required: true, trim: true },
      branchId: { ...objectId, ref: "Branch" },
      remarks: { type: String, trim: true },
      updatedBy: { ...objectId, ref: "User" },
    },
    { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
  ),
);
ShipmentEvent.schema.index({ shipmentId: 1, createdAt: 1 });

const shipmentDocumentSchema = new Schema(
  {
    shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
    documentType: { type: String, required: true, default: "LR_IMAGE", index: true },
    version: { type: Number, required: true, min: 1 },
    storageKey: { type: String, required: true, select: false },
    fileUrl: { type: String, select: false },
    originalFileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    checksum: { type: String, required: true },
    uploadedBy: { ...objectId, ref: "User" },
    uploadSource: { type: String, enum: ["INTERNAL", "CUSTOMER"], required: true },
    verificationStatus: {
      type: String,
      enum: Object.values(DOCUMENT_STATUS),
      default: DOCUMENT_STATUS.PENDING,
      index: true,
    },
    verifiedBy: { ...objectId, ref: "User" },
    verifiedAt: Date,
    rejectionReason: String,
  },
  base,
);
shipmentDocumentSchema.index(
  { shipmentId: 1, documentType: 1, verificationStatus: 1 },
  { unique: true, partialFilterExpression: { documentType: "LR_IMAGE", verificationStatus: "PENDING" } },
);
shipmentDocumentSchema.index({ shipmentId: 1, documentType: 1, version: 1 }, { unique: true });
export const ShipmentDocument = model("ShipmentDocument", shipmentDocumentSchema);

export const UploadSession = model(
  "UploadSession",
  new Schema(
    {
      shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
      tokenHash: { type: String, required: true, unique: true },
      expiresAt: { type: Date, required: true, index: { expires: 0 } },
      usedAt: Date,
      attemptCount: { type: Number, default: 0 },
      createdBy: { ...objectId, ref: "User" },
    },
    base,
  ),
);

export const AuditLog = model(
  "AuditLog",
  new Schema(
    {
      userId: { ...objectId, ref: "User" },
      action: { type: String, required: true, index: true },
      entityType: { type: String, required: true },
      entityId: String,
      oldValue: Schema.Types.Mixed,
      newValue: Schema.Types.Mixed,
      ipAddress: String,
      userAgent: String,
      requestId: String,
    },
    { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
  ),
);
