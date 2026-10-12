import mongoose from "mongoose";
import { base, objectId } from "./shared.js";
const { Schema, model } = mongoose;
const schema = new Schema({
  loaNumber: { type: String, required: true, trim: true, maxlength: 120, unique: true },
  branchId: { ...objectId, ref: "Branch", required: true, index: true },
  authorizedTo: { type: String, required: true, trim: true, maxlength: 180 },
  purpose: { type: String, required: true, trim: true, maxlength: 1000 },
  issueDate: { type: Date, required: true }, effectiveFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true, index: true },
  revokedAt: Date, documentReference: { type: String, trim: true, maxlength: 180 },
  document: { storageKey: String, fileUrl: String, originalFileName: String, mimeType: String },
  createdBy: { ...objectId, ref: "User", required: true },
}, base);
schema.index({ branchId: 1, issueDate: -1, _id: -1 });
export const LetterAuthorization = model("LetterAuthorization", schema);
