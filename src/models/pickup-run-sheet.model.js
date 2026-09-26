import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const purEntrySchema = new Schema(
  {
    pickupRequestId: { ...objectId, ref: "PickupRequest", required: true },
    shipmentId: { ...objectId, ref: "Shipment", required: true },
    paymentTerm: { type: String, enum: ["PAID", "PREPAID", "CREDIT"], required: true },
    amount: { type: Number, required: true, min: 0 },
    addedAt: { type: Date, default: Date.now },
    addedBy: { ...objectId, ref: "User", required: true },
  },
  { _id: false },
);

const pickupRunSheetSchema = new Schema(
  {
    prsNumber: { type: String, required: true, unique: true, index: true },
    dispatchId: { type: String, sparse: true, unique: true, index: true },
    branchId: { ...objectId, ref: "Branch", required: true, index: true },
    vendorCategory: { type: String, enum: ["TRANSPORTER", "BP_KG"], required: true },
    rateSource: { type: String, enum: ["MASTER", "MARKET"], required: true },
    vendorId: { ...objectId, ref: "Vendor", required: true, index: true },
    vendorCode: { type: String, required: true, trim: true },
    vendorName: { type: String, required: true, trim: true },
    rateBasis: { type: String, enum: ["PER_KG", "PER_BOX", "PER_TRIP", "FIXED"], required: true },
    agreedRate: { type: Number, required: true, min: 0 },
    marketAmount: { type: Number, min: 0 },
    vendorPayableAmount: { type: Number, min: 0, default: 0 },
    approvalStatus: { type: String, enum: ["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"], default: "NOT_REQUIRED", index: true },
    approvalRemarks: { type: String, trim: true, maxlength: 500 },
    approvedAt: Date,
    approvedBy: { ...objectId, ref: "User" },
    fieldExecutiveId: { ...objectId, ref: "User", required: true, index: true },
    fieldExecutiveName: { type: String, required: true, trim: true, maxlength: 120 },
    fieldExecutiveMobile: { type: String, required: true, trim: true, maxlength: 16 },
    vehicleNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 20, index: true },
    vehicleType: { type: String, required: true, trim: true, maxlength: 80 },
    driverName: { type: String, trim: true, maxlength: 120 },
    driverMobile: { type: String, trim: true, maxlength: 16 },
    pickupDate: { type: Date, required: true, index: true },
    route: { type: String, required: true, trim: true, maxlength: 250 },
    pickupRequestIds: [{ ...objectId, ref: "PickupRequest" }],
    shipmentIds: [{ ...objectId, ref: "Shipment" }],
    purEntries: { type: [purEntrySchema], default: [] },
    totalBoxes: { type: Number, min: 0, default: 0 },
    totalWeightKg: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["DRAFT", "READY", "PENDING_APPROVAL", "DISPATCHED", "CANCELLED"], default: "DRAFT", index: true },
    dispatchedAt: Date,
    dispatchedBy: { ...objectId, ref: "User" },
    remarks: { type: String, trim: true, maxlength: 500 },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);

pickupRunSheetSchema.index({ branchId: 1, createdAt: -1, _id: -1 });
pickupRunSheetSchema.index({ pickupRequestIds: 1 });
pickupRunSheetSchema.index({ shipmentIds: 1 });

export const PickupRunSheet = model("PickupRunSheet", pickupRunSheetSchema);
