import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

export const TMS_REGISTER_MODULES = [
  "PICKUP", "PTL", "FTL", "HUB", "HANDLING", "FLEET", "DRIVER",
  "VENDOR_SETTLEMENT", "EWAY_GST", "ACCOUNTING", "HR", "CLAIM",
  "NOTIFICATION", "SYSTEM_SETTING",
];

const tmsRegisterSchema = new Schema(
  {
    recordNumber: { type: String, required: true, unique: true, index: true },
    module: { type: String, enum: TMS_REGISTER_MODULES, required: true, index: true },
    branchId: { ...objectId, ref: "Branch", required: true, index: true },
    shipmentIds: [{ ...objectId, ref: "Shipment" }],
    vendorId: { ...objectId, ref: "Vendor", index: true },
    customerId: { ...objectId, ref: "Customer", index: true },
    userId: { ...objectId, ref: "User", index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    reference: { type: String, trim: true, maxlength: 120 },
    operationDate: { type: Date, required: true, index: true },
    dueDate: Date,
    origin: { type: String, trim: true, maxlength: 150 },
    destination: { type: String, trim: true, maxlength: 150 },
    vehicleNumber: { type: String, trim: true, uppercase: true, maxlength: 20 },
    driverName: { type: String, trim: true, maxlength: 120 },
    driverMobile: { type: String, trim: true, maxlength: 16 },
    documentNumber: { type: String, trim: true, maxlength: 120 },
    quantity: { type: Number, min: 0, default: 0 },
    amount: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ["OPEN", "PLANNED", "IN_PROGRESS", "COMPLETED", "APPROVED", "PAID", "REJECTED", "CANCELLED", "INACTIVE"],
      default: "OPEN",
      index: true,
    },
    description: { type: String, trim: true, maxlength: 1000 },
    remarks: { type: String, trim: true, maxlength: 1000 },
    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
    createdBy: { ...objectId, ref: "User", required: true },
    updatedBy: { ...objectId, ref: "User" },
  },
  base,
);

tmsRegisterSchema.index({ module: 1, branchId: 1, createdAt: -1, _id: -1 });
tmsRegisterSchema.index({ module: 1, status: 1, operationDate: -1 });
tmsRegisterSchema.index({ module: 1, vehicleNumber: 1, operationDate: -1 });

export const TmsRegister = model("TmsRegister", tmsRegisterSchema);
