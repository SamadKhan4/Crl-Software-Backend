import { AuditLog } from "../models/index.js";
import { ROLES } from "../constants/workflow.js";
import { AuthorizationError } from "../utils/errors.js";
import { listQuery, paginated } from "../utils/query.js";

const visibleFields = [
  "name",
  "email",
  "mobile",
  "branchId",
  "status",
  "currentStatus",
  "location",
  "senderName",
  "receiverName",
  "packageCount",
  "weightKg",
  "description",
  "city",
  "address",
  "expectedDeliveryDate",
];

export async function listActivity(query, user) {
  const options = listQuery({ ...query, sortBy: "createdAt", sortOrder: "desc" });
  const filter = {};
  if (user.role === ROLES.EMPLOYEE) filter.userId = user._id;
  else if (user.role === ROLES.MANAGER) {
    if (!user.branchId) throw new AuthorizationError("A branch assignment is required");
    // Historical branch ownership is immutable; transfers must not expose another branch's events.
    filter.$or = [{ actorBranchId: user.branchId }, { userId: user._id }];
  } else if (user.role !== ROLES.ADMIN) throw new AuthorizationError();
  if (query.action) filter.action = query.action;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.dateFrom || query.dateTo)
    filter.createdAt = {
      ...(query.dateFrom && { $gte: query.dateFrom }),
      ...(query.dateTo && { $lte: query.dateTo }),
    };
  if (query.search) {
    const search = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$and = [
      {
        $or: ["actorName", "action", "entityType", "entityLabel", "entityId"].map((key) => ({
          [key]: { $regex: search, $options: "i" },
        })),
      },
    ];
  }
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .select(
        [
          "userId",
          "actorName",
          "actorRole",
          "action",
          "entityType",
          "entityId",
          "entityLabel",
          "createdAt",
          ...visibleFields.flatMap((field) => [`oldValue.${field}`, `newValue.${field}`]),
        ].join(" "),
      )
      .populate({ path: "userId", select: "name role", transform: (doc, id) => doc || (id ? { _id: id } : null) })
      .sort({ createdAt: -1, _id: -1 })
      .skip(options.skip)
      .limit(options.limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return paginated(
    items.map((event) => ({
      id: event._id,
      actor: {
        id: event.userId?._id,
        name: event.actorName || event.userId?.name || (event.userId ? "Former team member" : "System / public upload"),
        role: event.actorRole || event.userId?.role || null,
      },
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      entityLabel: event.entityLabel || event.entityId,
      createdAt: event.createdAt,
      changedFields:
        event.oldValue && event.newValue
          ? visibleFields.filter(
              (field) => JSON.stringify(event.oldValue[field]) !== JSON.stringify(event.newValue[field]),
            )
          : [],
    })),
    total,
    options,
  );
}
