import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const slabSchema = new Schema(
  {
    from: { type: Number, required: true, min: 0 },
    to: { type: Number, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    minimumCharge: { type: Number, min: 0, default: 0 },
  },
  { _id: false, strict: true },
);

const chargeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    basis: {
      type: String,
      enum: ["FIXED", "PER_BOX", "PER_KG", "PER_KM", "PERCENTAGE", "PER_VEHICLE"],
      required: true,
    },
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: true },
);

const rateCardSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 50 },
    partyType: { type: String, enum: ["CLIENT", "VENDOR"], required: true, index: true },
    customerId: { ...objectId, ref: "Customer", index: true },
    vendorId: { ...objectId, ref: "Vendor", index: true },
    service: { type: String, enum: ["FM", "MM", "LM", "PTL", "FTL", "PICKUP", "DELIVERY", "HUB_TRANSFER"], required: true },
    origin: { type: String, trim: true, maxlength: 150 },
    destination: { type: String, trim: true, maxlength: 150 },
    pincode: { type: String, trim: true, match: /^\d{6}$/ },
    zone: { type: String, trim: true, maxlength: 80 },
    vehicleType: { type: String, trim: true, maxlength: 80 },
    basis: {
      type: String,
      enum: ["PER_BOX", "PER_KG", "PER_CHARGED_KG", "PER_TON", "PER_CFT", "PER_CBM", "PER_KM", "PER_VEHICLE", "PER_TRIP", "PER_LR", "PER_SHIPMENT", "FIXED", "SLAB", "PERCENTAGE"],
      required: true,
    },
    rate: { type: Number, required: true, min: 0 },
    minimumCharge: { type: Number, min: 0, default: 0 },
    minimumWeightKg: { type: Number, min: 0, default: 0 },
    slabs: { type: [slabSchema], default: [] },
    charges: { type: [chargeSchema], default: [] },
    inclusions: {
      toll: { type: Boolean, default: false },
      loading: { type: Boolean, default: false },
      unloading: { type: Boolean, default: false },
      driverBata: { type: Boolean, default: false },
      fuel: { type: Boolean, default: false },
    },
    gstRate: { type: Number, min: 0, max: 100, default: 0 },
    tdsRate: { type: Number, min: 0, max: 100, default: 0 },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, index: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
    createdBy: { ...objectId, ref: "User", required: true },
    updatedBy: { ...objectId, ref: "User" },
  },
  base,
);

rateCardSchema.index({ partyType: 1, customerId: 1, vendorId: 1, service: 1, origin: 1, destination: 1, status: 1 });

export const RateCard = model("RateCard", rateCardSchema);
