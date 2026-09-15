import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const refreshTokenSchema = new Schema(
  {
    userId: { ...objectId, ref: "User", required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: Date,
    replacedAt: Date,
  },
  base,
);
refreshTokenSchema.index({ familyId: 1, revokedAt: 1 });

export const RefreshToken = model("RefreshToken", refreshTokenSchema);
