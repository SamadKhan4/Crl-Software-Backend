import mongoose from "mongoose";
import { ACTIVE } from "../constants/workflow.js";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const vehicleSchema = new Schema(
  {
    vehicleNumber: { type: String, required: true, uppercase: true, trim: true },
    vehicleType: { type: String, trim: true },
    capacityKg: { type: Number, min: 0 },
    driverName: { type: String, trim: true },
    driverMobile: { type: String, trim: true },
    status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE },
  },
  { _id: false },
);

const vendorSchema = new Schema(
  {
    vendorCode: { type: String, required: true, unique: true, index: true },
    vendorType: {
      type: String,
      enum: ["TRANSPORTER", "CO_LOADER", "VEHICLE_OWNER", "LAST_MILE"],
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, index: true },
    contactPerson: { type: String, trim: true },
    mobile: { type: String, required: true, trim: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true, index: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    gstNumber: { type: String, uppercase: true, trim: true, sparse: true, index: true },
    commercial: {
      rateBasis: { type: String, enum: ["PER_KG", "PER_BOX", "PER_TRIP", "FIXED"], default: "PER_TRIP" },
      rate: { type: Number, min: 0, default: 0 },
      fuelSurchargePercent: { type: Number, min: 0, max: 100, default: 0 },
      handlingCharge: { type: Number, min: 0, default: 0 },
      detentionPerDay: { type: Number, min: 0, default: 0 },
      creditDays: { type: Number, min: 0, max: 365, default: 0 },
      gstRate: { type: Number, min: 0, max: 100, default: 0 },
    },
    vehicles: { type: [vehicleSchema], default: [] },
    status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE, index: true },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);

vendorSchema.index({ status: 1, name: 1, _id: 1 });
vendorSchema.index({ "vehicles.vehicleNumber": 1 });

export const Vendor = model("Vendor", vendorSchema);
