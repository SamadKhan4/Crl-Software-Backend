import mongoose from "mongoose";
import { MIDDLE_MILE_STATE } from "../constants/workflow.js";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const movementLegSchema = new Schema(
  {
    shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
    legNumber: { type: Number, required: true, min: 1 },
    fromHubId: { ...objectId, ref: "Branch", required: true, index: true },
    toHubId: { ...objectId, ref: "Branch", required: true, index: true },
    routeId: { ...objectId, ref: "BusinessMaster", index: true },
    status: { type: String, enum: Object.values(MIDDLE_MILE_STATE), required: true, index: true },
    segregationId: { ...objectId, ref: "Segregation" },
    loadingTallyId: { ...objectId, ref: "LoadingTally" },
    manifestId: { ...objectId, ref: "Manifest" },
    tripId: { ...objectId, ref: "Trip" },
    vehicleNumber: { type: String, uppercase: true, trim: true },
    driverName: { type: String, trim: true },
    inwardedAt: Date,
    sortedAt: Date,
    loadedAt: Date,
    dispatchedAt: Date,
    arrivedAt: Date,
    completedAt: Date,
    operatedBy: { ...objectId, ref: "User", required: true },
    remarks: { type: String, trim: true, maxlength: 500 },
  },
  base,
);
movementLegSchema.index({ shipmentId: 1, legNumber: 1 }, { unique: true });
movementLegSchema.index({ fromHubId: 1, status: 1, createdAt: -1 });

const tallyItemSchema = new Schema(
  {
    shipmentId: { ...objectId, ref: "Shipment", required: true },
    expectedPackages: { type: Number, required: true, min: 1 },
    scannedBarcodes: [{ type: String, uppercase: true, trim: true }],
    scannedPackages: { type: Number, min: 0, default: 0 },
    weightKg: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["PENDING", "LOADING", "LOADED", "MISMATCH", "HOLD"], default: "PENDING" },
  },
  { _id: false, strict: true },
);

const loadingTallySchema = new Schema(
  {
    tallyNumber: { type: String, required: true, unique: true, index: true },
    branchId: { ...objectId, ref: "Branch", required: true, index: true },
    fromHubId: { ...objectId, ref: "Branch", required: true, index: true },
    toHubId: { ...objectId, ref: "Branch", required: true, index: true },
    routeId: { ...objectId, ref: "BusinessMaster", index: true },
    segregationId: { ...objectId, ref: "Segregation", required: true, unique: true, index: true },
    shipmentIds: [{ ...objectId, ref: "Shipment", required: true }],
    items: { type: [tallyItemSchema], default: [] },
    loadingBay: { type: String, trim: true, maxlength: 80 },
    vehicleType: { type: String, trim: true, maxlength: 80 },
    vehicleCapacityKg: { type: Number, min: 0 },
    totalLrs: { type: Number, min: 0, default: 0 },
    totalPackages: { type: Number, min: 0, default: 0 },
    totalWeightKg: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["DRAFT", "LOADING", "TALLY_COMPLETED", "MANIFEST_READY"], default: "DRAFT", index: true },
    completedAt: Date,
    completedBy: { ...objectId, ref: "User" },
    createdBy: { ...objectId, ref: "User", required: true },
    remarks: { type: String, trim: true, maxlength: 500 },
  },
  base,
);
loadingTallySchema.index({ branchId: 1, status: 1, createdAt: -1 });
loadingTallySchema.index({ shipmentIds: 1, status: 1 });

export const MovementLeg = model("MovementLeg", movementLegSchema);
export const LoadingTally = model("LoadingTally", loadingTallySchema);
