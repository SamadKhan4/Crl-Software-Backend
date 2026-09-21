import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const documentSchema = new Schema({
  documentType: { type: String, enum: ["ID_PROOF", "ADDRESS_PROOF", "PHOTO", "EDUCATION", "OTHER"], required: true },
  storageKey: { type: String, required: true, select: false },
  fileUrl: { type: String, select: false },
  originalFileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  fileSize: { type: Number, required: true },
  checksum: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

const employeeOnboardingSchema = new Schema({
  onboardingNumber: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  mobile: { type: String, required: true, trim: true },
  alternateMobile: { type: String, trim: true },
  dateOfBirth: Date,
  joiningDate: { type: Date, required: true },
  designation: { type: String, required: true, trim: true, maxlength: 120 },
  department: { type: String, required: true, trim: true, maxlength: 120 },
  branchId: { ...objectId, ref: "Branch", required: true, index: true },
  address: { type: String, trim: true, maxlength: 500 },
  city: { type: String, trim: true, maxlength: 100 },
  state: { type: String, trim: true, maxlength: 100 },
  pincode: { type: String, trim: true },
  emergencyContactName: { type: String, trim: true, maxlength: 120 },
  emergencyContactMobile: { type: String, trim: true },
  panNumber: { type: String, trim: true, uppercase: true },
  aadhaarLast4: { type: String, trim: true },
  documents: { type: [documentSchema], default: [] },
  status: { type: String, enum: ["PENDING_MANAGER", "APPROVED", "REJECTED"], default: "PENDING_MANAGER", index: true },
  managerRemarks: { type: String, trim: true, maxlength: 500 },
  createdBy: { ...objectId, ref: "User", required: true },
  reviewedBy: { ...objectId, ref: "User" },
  reviewedAt: Date,
  userId: { ...objectId, ref: "User" },
}, base);

employeeOnboardingSchema.index({ branchId: 1, status: 1, createdAt: -1 });
employeeOnboardingSchema.index({ email: 1, status: 1 });

export const EmployeeOnboarding = model("EmployeeOnboarding", employeeOnboardingSchema);
