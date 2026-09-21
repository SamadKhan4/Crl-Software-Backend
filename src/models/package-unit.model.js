import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const scanSchema = new Schema(
  {
    action: {
      type: String,
      enum: ["GENERATED", "PICKUP", "HUB_INWARD", "SORTED", "LOADED", "UNLOADED", "OUT_FOR_DELIVERY", "DELIVERED", "DAMAGE", "SHORT", "EXCESS", "HOLD", "MISROUTE", "CANCELLED"],
      required: true,
    },
    location: { type: String, required: true, trim: true, maxlength: 180 },
    branchId: { ...objectId, ref: "Branch" },
    routeCode: { type: String, trim: true, maxlength: 50 },
    vehicleNumber: { type: String, trim: true, uppercase: true, maxlength: 20 },
    remarks: { type: String, trim: true, maxlength: 500 },
    scannedBy: { ...objectId, ref: "User", required: true },
    scannedAt: { type: Date, default: Date.now },
  },
  { _id: true, strict: true },
);

const packageUnitSchema = new Schema(
  {
    barcode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
    lrNumber: { type: String, required: true, uppercase: true, trim: true, index: true },
    sequence: { type: Number, required: true, min: 1 },
    totalPackages: { type: Number, required: true, min: 1 },
    status: { type: String, default: "GENERATED", index: true },
    currentLocation: { type: String, trim: true, maxlength: 180 },
    currentCustodianType: { type: String, enum: ["BRANCH", "EMPLOYEE", "VENDOR", "VEHICLE", "CUSTOMER"] },
    currentCustodianId: { type: String, trim: true, maxlength: 100 },
    duplicatePrintCount: { type: Number, min: 0, default: 0 },
    scans: { type: [scanSchema], default: [] },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);

packageUnitSchema.index({ shipmentId: 1, sequence: 1 }, { unique: true });
packageUnitSchema.index({ status: 1, updatedAt: -1 });

export const PackageUnit = model("PackageUnit", packageUnitSchema);
