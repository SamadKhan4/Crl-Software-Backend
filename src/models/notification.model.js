import mongoose from "mongoose";
import { base, objectId } from "./shared.js";
const { Schema, model } = mongoose;
const notificationSchema = new Schema({
  event: { type: String, required: true, trim: true, maxlength: 80, index: true },
  shipmentId: { ...objectId, ref: "Shipment", index: true },
  invoiceId: { ...objectId, ref: "Invoice", index: true },
  customerId: { ...objectId, ref: "Customer", index: true },
  branchId: { ...objectId, ref: "Branch", index: true },
  recipientName: { type: String, trim: true, maxlength: 150 },
  mobile: { type: String, trim: true, maxlength: 20 },
  email: { type: String, trim: true, lowercase: true, maxlength: 180 },
  channels: [{ type: String, enum: ["WHATSAPP", "SMS", "EMAIL"] }],
  subject: { type: String, required: true, trim: true, maxlength: 180 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ["QUEUED", "SENT", "PARTIAL", "FAILED", "CANCELLED"], default: "QUEUED", index: true },
  attempts: { type: Number, min: 0, default: 0 },
  lastError: { type: String, trim: true, maxlength: 500 },
  sentAt: Date,
}, base);
notificationSchema.index({ status: 1, createdAt: 1 });
export const Notification = model("Notification", notificationSchema);
