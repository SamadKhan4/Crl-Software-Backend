import mongoose from "mongoose";
import { objectId } from "./shared.js";

const { Schema, model } = mongoose;

const auditLogSchema = new Schema(
  {
    userId: { ...objectId, ref: "User" },
    actorName: String,
    actorRole: String,
    actorBranchId: { ...objectId, ref: "Branch" },
    entityLabel: String,
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: String,
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ createdAt: -1, _id: -1 });
auditLogSchema.index({ actorBranchId: 1, createdAt: -1, _id: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1, _id: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = model("AuditLog", auditLogSchema);
