import mongoose from "mongoose";
import { SHIPMENT_STATUS } from "../constants/workflow.js";
import { objectId } from "./shared.js";

const { Schema, model } = mongoose;

const shipmentEventSchema = new Schema(
  {
    shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
    status: { type: String, enum: Object.values(SHIPMENT_STATUS), required: true, index: true },
    location: { type: String, required: true, trim: true },
    branchId: { ...objectId, ref: "Branch" },
    remarks: { type: String, trim: true },
    updatedBy: { ...objectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
shipmentEventSchema.index({ shipmentId: 1, createdAt: 1 });

export const ShipmentEvent = model("ShipmentEvent", shipmentEventSchema);
