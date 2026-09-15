import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const uploadSessionSchema = new Schema(
  {
    shipmentId: { ...objectId, ref: "Shipment", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: Date,
    attemptCount: { type: Number, default: 0 },
    createdBy: { ...objectId, ref: "User" },
  },
  base,
);

export const UploadSession = model("UploadSession", uploadSessionSchema);
