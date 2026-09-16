import mongoose from "mongoose";
import { ACTIVE } from "../constants/workflow.js";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const creditChargesSchema = new Schema(
  {
    freightBasis: { type: String, enum: ["PER_KG", "PER_BOX"], required: true, default: "PER_KG" },
    freightRate: { type: Number, min: 0, default: 0 },
    fuelRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    handlingCharges: { type: Number, min: 0, default: 0 },
    fodCharges: { type: Number, min: 0, default: 0 },
    codCharges: { type: Number, min: 0, default: 0 },
    rovRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    docketCharges: { type: Number, min: 0, default: 0 },
    gstRate: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false },
);

const customerSchema = new Schema(
  {
    customerCode: { type: String, required: true, unique: true, match: /^(?:\d{5}|CRLCUST\d{6})$/, index: true },
    customerType: { type: String, enum: ["CREDIT", "TO_PAY_PAID"], required: true, default: "TO_PAY_PAID" },
    creditCharges: { type: creditChargesSchema },
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
