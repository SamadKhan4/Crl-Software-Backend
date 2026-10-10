import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const unloadingItemSchema = new Schema({
  shipmentId: { ...objectId, ref: "Shipment", required: true },
  expectedPackages: { type: Number, min: 1, required: true },
  scannedBarcodes: [{ type: String, uppercase: true, trim: true }],
  receivedPackages: { type: Number, min: 0, default: 0 },
  shortPackages: { type: Number, min: 0, default: 0 },
  excessPackages: { type: Number, min: 0, default: 0 },
  damagedPackages: { type: Number, min: 0, default: 0 },
  qcStatus: { type: String, enum: ["PENDING", "PASSED", "HOLD"], default: "PENDING", index: true },
  depsCode: { type: String, trim: true, maxlength: 80 },
  depsRemarks: { type: String, trim: true, maxlength: 500 },
  receiptRemarks: { type: String, trim: true, maxlength: 500 },
  storageLocation: { type: String, trim: true, maxlength: 120 },
  checkedAt: Date,
  checkedBy: { ...objectId, ref: "User" },
}, { _id: false, strict: true });

const unloadingTallySchema = new Schema({
  tallyNumber: { type: String, required: true, unique: true, index: true },
  tripId: { ...objectId, ref: "Trip", required: true, unique: true, index: true },
  branchId: { ...objectId, ref: "Branch", required: true, index: true },
  shipmentIds: [{ ...objectId, ref: "Shipment", required: true }],
  items: { type: [unloadingItemSchema], default: [] },
  unloadingBay: { type: String, trim: true, maxlength: 80 },
  status: { type: String, enum: ["UNLOADING", "QC_PENDING", "READY_FOR_INWARD", "INWARDED", "CANCELLED"], default: "UNLOADING", index: true },
  totalLrs: { type: Number, min: 0, default: 0 },
  totalPackages: { type: Number, min: 0, default: 0 },
  scannedPackages: { type: Number, min: 0, default: 0 },
  completedAt: Date,
  completedBy: { ...objectId, ref: "User" },
  inwardedAt: Date,
  inwardedBy: { ...objectId, ref: "User" },
  remarks: { type: String, trim: true, maxlength: 500 },
  createdBy: { ...objectId, ref: "User", required: true },
}, base);
unloadingTallySchema.index({ branchId: 1, createdAt: -1, _id: -1 });
unloadingTallySchema.index({ shipmentIds: 1, status: 1 });
export const UnloadingTally = model("UnloadingTally", unloadingTallySchema);
