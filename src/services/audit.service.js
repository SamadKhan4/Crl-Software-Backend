import mongoose from "mongoose";
import { AuditLog } from "../models/index.js";
export const audit = async (session, req, action, entityType, entityId, oldValue, newValue) => {
  let entityLabel =
    newValue?.lrNumber ||
    oldValue?.lrNumber ||
    newValue?.name ||
    oldValue?.name ||
    newValue?.customerCode ||
    oldValue?.customerCode;
  if (!entityLabel && mongoose.models[entityType] && mongoose.isValidObjectId(entityId)) {
    const entity = await mongoose.models[entityType]
      .findById(entityId)
      .select("name lrNumber originalFileName")
      .session(session)
      .lean();
    entityLabel = entity?.lrNumber || entity?.name || entity?.originalFileName;
  }
  return AuditLog.create(
    [
      {
        userId: req.user?._id,
        actorName: req.user?.name,
        actorRole: req.user?.role,
        actorBranchId: req.user?.branchId,
        entityLabel,
        action,
        entityType,
        entityId: entityId?.toString(),
        oldValue,
        newValue,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        requestId: req.id,
      },
    ],
    { session },
  );
};
