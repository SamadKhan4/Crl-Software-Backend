import { AuditLog } from "../models/index.js";
export const audit = (session, req, action, entityType, entityId, oldValue, newValue) =>
  AuditLog.create(
    [
      {
        userId: req.user?._id,
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
