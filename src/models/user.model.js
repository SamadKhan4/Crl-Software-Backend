import mongoose from "mongoose";
import { ACTIVE, ROLES } from "../constants/workflow.js";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    employeeCode: { type: String, required: true, unique: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    mobile: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.EMPLOYEE },
    branchId: { ...objectId, ref: "Branch", index: true },
    status: { type: String, enum: Object.values(ACTIVE), default: ACTIVE.ACTIVE, index: true },
    lastLoginAt: Date,
  },
  base,
);
userSchema.index({ role: 1, createdAt: -1, _id: -1 });
userSchema.index({ role: 1, branchId: 1, createdAt: -1, _id: -1 });

export const User = model("User", userSchema);
