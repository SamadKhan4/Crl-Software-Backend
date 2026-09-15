import mongoose from "mongoose";
import { ACTIVE } from "../constants/workflow.js";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const customerSchema = new Schema(
  {
    customerCode: { type: String, required: true, unique: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    companyName: { type: String, trim: true, index: true },
    mobile: { type: String, required: true, trim: true, index: true },
    alternateMobile: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    gstNumber: { type: String, uppercase: true, trim: true, sparse: true, index: true },
    status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE, index: true },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);
customerSchema.index({ createdAt: -1, _id: -1 });
customerSchema.index({ status: 1, createdAt: -1, _id: -1 });
customerSchema.index({ createdBy: 1 });

export const Customer = model("Customer", customerSchema);
