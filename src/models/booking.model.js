import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const bookingSchema = new Schema({
  bookingNumber: { type: String, required: true, unique: true, index: true },
  branchId: { ...objectId, ref: "Branch", index: true },
  destinationBranchId: { ...objectId, ref: "Branch" },
  customerId: { ...objectId, ref: "Customer", index: true },
  bookingDate: { type: Date, default: Date.now, index: true },
  consignorCode: { type: String, trim: true, maxlength: 80 },
  consignor: { type: String, required: true, trim: true, maxlength: 120 },
  consignorAddress: { type: String, trim: true, maxlength: 500 },
  consignorAddress2: { type: String, trim: true, maxlength: 500 },
  consignorPincode: { type: String, trim: true, match: /^\d{6}$/ },
  consignorGstin: { type: String, trim: true, uppercase: true, match: /^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/ },
  consignee: { type: String, required: true, trim: true, maxlength: 120 },
  consigneeMobile: { type: String, trim: true, maxlength: 20 },
  consigneeAddress: { type: String, trim: true, maxlength: 500 },
  consigneeAddress2: { type: String, trim: true, maxlength: 500 },
  consigneeAddress3: { type: String, trim: true, maxlength: 500 },
  consigneePincode: { type: String, trim: true, match: /^\d{6}$/ },
  consigneeGstin: { type: String, trim: true, uppercase: true, match: /^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/ },
  origin: { type: String, trim: true, maxlength: 150 },
  destination: { type: String, trim: true, maxlength: 150 },
  service: { type: String, enum: ["PTL", "FTL", "FM", "MM", "LM"] },
  packageCount: { type: Number, min: 1, max: 10000 },
  weightKg: { type: Number, min: 0.01 },
  description: { type: String, trim: true, maxlength: 500 },
  invoiceNumber: { type: String, trim: true, maxlength: 120 },
  eWayBillNumber: { type: String, trim: true, maxlength: 120 },
  expectedDeliveryDate: Date,
  status: { type: String, enum: ["DRAFT", "CONFIRMED", "LR_GENERATED", "CANCELLED"], default: "CONFIRMED", index: true },
  shipmentId: { ...objectId, ref: "Shipment" },
  createdBy: { ...objectId, ref: "User", required: true },
}, base);
bookingSchema.index({ branchId: 1, createdAt: -1 });
export const Booking = model("Booking", bookingSchema);
