import mongoose from "mongoose";
import {
  Branch,
  Customer,
  User,
  Shipment,
  ShipmentEvent,
  ShipmentDocument,
  UploadSession,
  RefreshToken,
} from "../models/index.js";
import { ACTIVE, ROLES, SHIPMENT_STATUS } from "../constants/workflow.js";
import { AuthorizationError, ConflictError, NotFoundError } from "../utils/errors.js";
import { audit } from "./audit.service.js";

const resources = { branches: Branch, customers: Customer, users: User, managers: User, shipments: Shipment };

export async function deleteResource(resource, id, req) {
  if (req.user.role !== ROLES.ADMIN) throw new AuthorizationError();
  const Model = resources[resource];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const record = await Model.findById(id).session(session);
      if (!record) throw new NotFoundError("Record not found", "RECORD_NOT_FOUND");
      if (
        (resource === "users" || resource === "managers") &&
        record.role !== (resource === "managers" ? ROLES.MANAGER : ROLES.EMPLOYEE)
      )
        throw new AuthorizationError("Administrator accounts cannot be deleted");
      if (resource !== "shipments" && record.status !== ACTIVE.INACTIVE)
        throw new ConflictError("Deactivate the record before deleting it", "RECORD_ACTIVE");
      const references =
        resource === "branches"
          ? [
              [User, { branchId: id }],
              [Shipment, { $or: [{ originBranchId: id }, { destinationBranchId: id }, { receivingBranchId: id }] }],
              [ShipmentEvent, { branchId: id }],
            ]
          : resource === "customers"
            ? [[Shipment, { customerId: id }]]
            : resource === "users" || resource === "managers"
              ? [
                  [Customer, { createdBy: id }],
                  [Shipment, { $or: [{ createdBy: id }, { receivedBy: id }] }],
                  [ShipmentEvent, { updatedBy: id }],
                  [ShipmentDocument, { $or: [{ uploadedBy: id }, { verifiedBy: id }] }],
                  [UploadSession, { createdBy: id }],
                ]
              : [[ShipmentDocument, { shipmentId: id }]];
      for (const [Related, filter] of references) {
        if (await Related.exists(filter).session(session))
          throw new ConflictError("Record is referenced by existing data; retain it for history", "RECORD_IN_USE");
      }
      if (resource === "shipments") {
        if (record.currentStatus !== SHIPMENT_STATUS.BOOKED || record.idempotencyKey)
          throw new ConflictError(
            "Only booked shipments without an idempotency key can be deleted; cancel this shipment instead",
            "SHIPMENT_NOT_DELETABLE",
          );
        await ShipmentEvent.deleteMany({ shipmentId: id }, { session });
        await UploadSession.deleteMany({ shipmentId: id }, { session });
      }
      if (resource === "users" || resource === "managers") await RefreshToken.deleteMany({ userId: id }, { session });
      await Model.deleteOne({ _id: id }, { session });
      await audit(
        session,
        req,
        `${Model.modelName.toUpperCase()}_DELETED`,
        Model.modelName,
        id,
        record.toObject(),
        null,
      );
    });
    return { id, deleted: true };
  } finally {
    await session.endSession();
  }
}
