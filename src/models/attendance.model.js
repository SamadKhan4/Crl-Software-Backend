import mongoose from "mongoose";
import { base, objectId } from "./shared.js";
const attendanceSchema = new mongoose.Schema({
  employeeId: { ...objectId, ref: "User", required: true },
  date: { type: String, required: true },
  status: { type: String, enum: ["PRESENT", "ABSENT", "UNPAID_LEAVE", "PAID_LEAVE", "HALF_DAY"], required: true },
  remarks: { type: String, maxlength: 500 },
  updatedBy: { ...objectId, ref: "User", required: true },
}, base);
attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
const holidaySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 150 },
  updatedBy: { ...objectId, ref: "User", required: true },
}, base);
export const Attendance = mongoose.model("Attendance", attendanceSchema);
export const Holiday = mongoose.model("Holiday", holidaySchema);
