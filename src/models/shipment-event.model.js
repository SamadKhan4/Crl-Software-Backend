import mongoose from "mongoose";
import { TRACKING_EVENT_STATUS } from "../constants/workflow.js";
import { objectId } from "./shared.js";

const { Schema, model } = mongoose;

const shipmentEventSchema = new Schema(
  {
    shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
    status: { type: String, enum: Object.values(TRACKING_EVENT_STATUS), required: true, index: true },
    location: { type: String, required: true, trim: true },
    branchId: { ...objectId, ref: "Branch" },
    movementLegId: { ...objectId, ref: "MovementLeg" },
    loadingTallyId: { ...objectId, ref: "LoadingTally" },
    unloadingTallyId: { ...objectId, ref: "UnloadingTally" },
    manifestId: { ...objectId, ref: "Manifest" },
    tripId: { ...objectId, ref: "Trip" },
    drsId: { ...objectId, ref: "DeliveryRunSheet" },
    remarks: { type: String, trim: true },
    updatedBy: { ...objectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
shipmentEventSchema.index({ shipmentId: 1, createdAt: 1 });

export const ShipmentEvent = model("ShipmentEvent", shipmentEventSchema);
