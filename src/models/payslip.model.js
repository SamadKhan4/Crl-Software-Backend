import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const salaryParts = {
  basic: { type: Number, min: 0, default: 0 },
  hra: { type: Number, min: 0, default: 0 },
  conveyance: { type: Number, min: 0, default: 0 },
  allowance: { type: Number, min: 0, default: 0 },
  bonus: { type: Number, min: 0, default: 0 },
  other: { type: Number, min: 0, default: 0 },
  _id: false,
};
const deductionParts = {
  pf: { type: Number, min: 0, default: 0 },
  esi: { type: Number, min: 0, default: 0 },
  professionalTax: { type: Number, min: 0, default: 0 },
  tds: { type: Number, min: 0, default: 0 },
  advance: { type: Number, min: 0, default: 0 },
  other: { type: Number, min: 0, default: 0 },
  _id: false,
};

const payslipSchema = new Schema(
  {
    payslipNumber: { type: String, required: true, unique: true, index: true },
    employeeId: { ...objectId, ref: "User", required: true, index: true },
    branchId: { ...objectId, ref: "Branch", required: true, index: true },
    salaryMonth: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
    designation: { type: String, trim: true, maxlength: 120 },
    department: { type: String, trim: true, maxlength: 120 },
    paidDays: { type: Number, min: 0, max: 31, default: 0 },
    earnings: { type: salaryParts, default: {} },
    deductions: { type: deductionParts, default: {} },
    grossEarnings: { type: Number, min: 0, required: true },
    totalDeductions: { type: Number, min: 0, required: true },
    netPay: { type: Number, min: 0, required: true },
    paymentDate: Date,
    paymentReference: { type: String, trim: true, maxlength: 150 },
    notes: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ["DRAFT", "ISSUED", "CANCELLED"], default: "DRAFT", index: true },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);
payslipSchema.index({ employeeId: 1, salaryMonth: 1 }, { unique: true });
payslipSchema.index({ branchId: 1, salaryMonth: -1, createdAt: -1 });

export const Payslip = model("Payslip", payslipSchema);
