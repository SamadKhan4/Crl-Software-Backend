import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const bookingSchema = new Schema({
  bookingNumber: { type: String, required: true, unique: true, index: true },
  branchId: { ...objectId, ref: "Branch", required: true, index: true },
  destinationBranchId: { ...objectId, ref: "Branch", required: true },
  customerId: { ...objectId, ref: "Customer", required: true, index: true },
  bookingDate: { type: Date, required: true, index: true },
  consignor: { type: String, required: true, trim: true, maxlength: 120 },
  consignee: { type: String, required: true, trim: true, maxlength: 120 },
  consigneeMobile: { type: String, trim: true, maxlength: 20 },
  origin: { type: String, required: true, trim: true, maxlength: 150 },
  destination: { type: String, required: true, trim: true, maxlength: 150 },
  service: { type: String, enum: ["PTL", "FTL", "FM", "MM", "LM"], required: true },
  packageCount: { type: Number, required: true, min: 1, max: 10000 },
  weightKg: { type: Number, required: true, min: 0.01 },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  invoiceNumber: { type: String, trim: true, maxlength: 120 },
  eWayBillNumber: { type: String, trim: true, maxlength: 120 },
  expectedDeliveryDate: Date,
  status: { type: String, enum: ["DRAFT", "CONFIRMED", "LR_GENERATED", "CANCELLED"], default: "CONFIRMED", index: true },
  shipmentId: { ...objectId, ref: "Shipment" },
  createdBy: { ...objectId, ref: "User", required: true },
}, base);
bookingSchema.index({ branchId: 1, createdAt: -1 });
export const Booking = model("Booking", bookingSchema);
