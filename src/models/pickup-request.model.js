import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const partySchema = new Schema(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 150 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    pincode: { type: String, required: true, trim: true, match: /^\d{6}$/ },
    gstin: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/,
    },
    contactName: { type: String, trim: true, maxlength: 120 },
    contactMobile: { type: String, trim: true, maxlength: 16 },
  },
  { _id: false },
);

const agentAssignmentSchema = new Schema(
  {
    sourceType: { type: String, enum: ["VENDOR", "MARKET"], required: true },
    vendorId: { ...objectId, ref: "Vendor" },
    agentName: { type: String, required: true, trim: true, maxlength: 120 },
    vehicleNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    vehicleType: { type: String, trim: true, maxlength: 80 },
    driverName: { type: String, required: true, trim: true, maxlength: 120 },
    driverMobile: { type: String, required: true, trim: true, maxlength: 16 },
    remarks: { type: String, trim: true, maxlength: 500 },
    assignedAt: { type: Date, required: true },
    assignedBy: { ...objectId, ref: "User", required: true },
  },
  { _id: false },
);

const pickupRequestSchema = new Schema(
  {
    pickupRequestNumber: { type: String, required: true, unique: true, index: true },
    branchId: { ...objectId, ref: "Branch", index: true },
    customerId: { ...objectId, ref: "Customer", index: true },
    shipper: { type: partySchema, required: true },
    recipient: { type: partySchema, required: true },
    serviceType: { type: String, enum: ["FTL", "PTL"], required: true, index: true },
    movementType: {
      type: String,
      enum: ["HUB_TO_HUB", "DOOR_TO_DOOR", "HUB_TO_DOOR", "DOOR_TO_HUB"],
    },
    totalBoxes: { type: Number, required: true, min: 1, max: 10000 },
    totalWeightKg: { type: Number, required: true, min: 0.01, max: 100000 },
    status: {
      type: String,
      enum: ["PENDING", "DISPATCHED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },
    createdSource: { type: String, enum: ["INTERNAL", "CLIENT"], default: "INTERNAL" },
    createdBy: { ...objectId, ref: "User", required: true },
    agentAssignment: agentAssignmentSchema,
    shipmentId: { ...objectId, ref: "Shipment", sparse: true, unique: true, index: true },
    pickupRunSheetId: { ...objectId, ref: "PickupRunSheet", index: true },
    lrCreatedAt: Date,
    dispatchedAt: Date,
    dispatchedBy: { ...objectId, ref: "User" },
  },
  base,
);

pickupRequestSchema.index({ branchId: 1, status: 1, createdAt: -1 });
pickupRequestSchema.index({ "shipper.companyName": 1, createdAt: -1 });

export const PickupRequest = model("PickupRequest", pickupRequestSchema);
