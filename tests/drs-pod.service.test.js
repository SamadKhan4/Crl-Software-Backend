import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { AuditLog, DeliveryRunSheet, Shipment, ShipmentDocument, ShipmentEvent } from "../src/models/index.js";
import { uploadDrsPod } from "../src/services/tms.service.js";
import { storageService } from "../src/services/storage.service.js";

afterEach(() => jest.restoreAllMocks());

test.each([undefined, "", "   ", "Nagpur delivery"])("uploads POD with route %s and a valid tracking location", async (route) => {
  const shipmentId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const drs = new DeliveryRunSheet({
    _id: new mongoose.Types.ObjectId(), drsNumber: "DRS-001", branchId: new mongoose.Types.ObjectId(),
    vehicleNumber: "MH31AB1234", driverName: "Driver", deliveryDate: new Date(), createdBy: userId,
    shipmentIds: [shipmentId], items: [{ shipmentId, attemptStatus: "DELIVERED" }],
    workflowStatus: "DISPATCHED", route,
  });
  const session = { withTransaction: async (run) => run(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(DeliveryRunSheet, "findById").mockReturnValue({
    then: (resolve) => resolve(drs), session: async () => drs,
    select: () => ({ session: () => ({ lean: async () => ({}) }) }),
  });
  jest.spyOn(drs, "save").mockResolvedValue(drs);
  const shipment = { _id: shipmentId, save: jest.fn() };
  jest.spyOn(Shipment, "findById").mockReturnValue({
    select: () => ({ lean: async () => ({ receiverName: "Receiver" }) }), session: async () => shipment,
  });
  jest.spyOn(storageService, "saveDocument").mockResolvedValue({ storageKey: "pod-file" });
  const remove = jest.spyOn(storageService, "remove").mockResolvedValue();
  jest.spyOn(ShipmentDocument, "countDocuments").mockReturnValue({ session: async () => 0 });
  jest.spyOn(ShipmentDocument, "create").mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }]);
  const events = jest.spyOn(ShipmentEvent, "insertMany").mockImplementation(async (rows) => {
    for (const row of rows) await new ShipmentEvent(row).validate();
    return rows;
  });
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  await uploadDrsPod(String(drs._id), String(shipmentId), { buffer: Buffer.from("pod") }, {
    user: { _id: userId, role: "ADMIN" }, body: { receiverName: "Receiver" }, get: () => "test",
  });
  expect(events).toHaveBeenCalledWith([expect.objectContaining({
    status: "POD_UPLOADED", location: route?.trim() || "Delivered",
  })], { session });
  expect(drs.podShipmentIds.map(String)).toContain(String(shipmentId));
  expect(remove).not.toHaveBeenCalled();
});
