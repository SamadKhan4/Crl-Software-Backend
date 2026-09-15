import mongoose from "mongoose";
import { ACTIVE } from "../constants/workflow.js";
import { base } from "./shared.js";

const { Schema, model } = mongoose;

const branchSchema = new Schema(
  {
    branchCode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    address: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE, index: true },
  },
  base,
);
branchSchema.index({ status: 1, name: 1, _id: 1 });

export const Branch = model("Branch", branchSchema);
