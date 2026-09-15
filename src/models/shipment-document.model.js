import mongoose from "mongoose";
import { DOCUMENT_STATUS } from "../constants/workflow.js";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

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
