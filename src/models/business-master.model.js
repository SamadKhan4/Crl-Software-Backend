import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

export const MASTER_TYPES = Object.freeze([
  "COMPANY",
  "LOCATION",
  "ROUTE",
  "ITEM",
  "PACKAGE",
  "VEHICLE",
  "DRIVER",
]);

const documentSchema = new Schema(
  {
    type: { type: String, trim: true, maxlength: 60 },
    number: { type: String, trim: true, maxlength: 120 },
    issuedAt: Date,
    expiresAt: Date,
    fileUrl: { type: String, trim: true, maxlength: 1000 },
    verified: { type: Boolean, default: false },
  },
  { _id: true, strict: true },
);

const businessMasterSchema = new Schema(
  {
    type: { type: String, enum: MASTER_TYPES, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 180 },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
    branchId: { ...objectId, ref: "Branch", index: true },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    pincode: { type: String, trim: true, match: /^\d{6}$/ },
    zone: { type: String, trim: true, maxlength: 80 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    origin: { type: String, trim: true, maxlength: 150 },
    destination: { type: String, trim: true, maxlength: 150 },
    distanceKm: { type: Number, min: 0 },
    transitDays: { type: Number, min: 0, max: 365 },
    intermediateHubs: [{ type: String, trim: true, maxlength: 120 }],
    vehicleType: { type: String, trim: true, maxlength: 80 },
    vehicleNumber: { type: String, trim: true, uppercase: true, maxlength: 20 },
    vendorId: { ...objectId, ref: "Vendor", index: true },
    driverId: { ...objectId, ref: "User" },
    capacityKg: { type: Number, min: 0 },
    capacityTon: { type: Number, min: 0 },
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    cft: { type: Number, min: 0 },
    hsn: { type: String, trim: true, maxlength: 20 },
    category: { type: String, trim: true, maxlength: 100 },
    standardWeight: { type: Number, min: 0 },
    packageType: { type: String, trim: true, maxlength: 80 },
    flags: {
      serviceable: { type: Boolean, default: true },
      oda: { type: Boolean, default: false },
      fragile: { type: Boolean, default: false },
      hazardous: { type: Boolean, default: false },
      perishable: { type: Boolean, default: false },
      temperatureControlled: { type: Boolean, default: false },
    },
    contact: {
      person: { type: String, trim: true, maxlength: 120 },
      mobile: { type: String, trim: true, maxlength: 20 },
      email: { type: String, trim: true, lowercase: true, maxlength: 180 },
    },
    registration: {
      gstin: { type: String, trim: true, uppercase: true, maxlength: 15 },
      pan: { type: String, trim: true, uppercase: true, maxlength: 10 },
      tan: { type: String, trim: true, uppercase: true, maxlength: 10 },
      cin: { type: String, trim: true, uppercase: true, maxlength: 30 },
      udyam: { type: String, trim: true, maxlength: 40 },
      iec: { type: String, trim: true, maxlength: 40 },
    },
    bank: {
      bankName: { type: String, trim: true, maxlength: 120 },
      accountName: { type: String, trim: true, maxlength: 150 },
      accountNumber: { type: String, trim: true, maxlength: 40 },
      ifsc: { type: String, trim: true, uppercase: true, maxlength: 11 },
      branch: { type: String, trim: true, maxlength: 120 },
      upi: { type: String, trim: true, maxlength: 120 },
    },
    documentSeries: {
      lr: String,
      invoice: String,
      creditNote: String,
      debitNote: String,
      receipt: String,
      payment: String,
      manifest: String,
      trip: String,
      epod: String,
      vendorBill: String,
    },
    financial: {
      hireRate: { type: Number, min: 0, default: 0 },
      driverCost: { type: Number, min: 0, default: 0 },
      fuelCost: { type: Number, min: 0, default: 0 },
      maintenanceCost: { type: Number, min: 0, default: 0 },
      toll: { type: Number, min: 0, default: 0 },
      fmRate: { type: Number, min: 0, default: 0 },
      mmRate: { type: Number, min: 0, default: 0 },
      lmRate: { type: Number, min: 0, default: 0 },
    },
    documents: { type: [documentSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 2000 },
    createdBy: { ...objectId, ref: "User", required: true },
    updatedBy: { ...objectId, ref: "User" },
  },
  base,
);

businessMasterSchema.index({ type: 1, code: 1 }, { unique: true });
businessMasterSchema.index({ type: 1, status: 1, name: 1 });
businessMasterSchema.index({ "documents.expiresAt": 1, status: 1 });

export const BusinessMaster = model("BusinessMaster", businessMasterSchema);
