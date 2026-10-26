import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { AuditLog, Branch, Counter, Manifest, MovementLeg, PackageUnit, Shipment, ShipmentEvent, Trip, UnloadingTally } from "../src/models/index.js";
import { arriveTrip } from "../src/services/middle-mile.service.js";
import { createUnloadingTally, completeUnloadingTally } from "../src/services/last-mile.service.js";

const req = { user: { role: "ADMIN", _id: "admin" }, get: () => "test" };
let session;
beforeEach(() => {
  session = { withTransaction: async (work) => work(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(Branch, "findById").mockReturnValue({ session: async () => ({ name: "Nagpur Branch", city: "Nagpur" }) });
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

test("arrival marks final-destination LRs ready for Last Mile and leaves onward LRs for sorting", async () => {
  const trip = { _id: "trip", status: "DISPATCHED", destination: "Nagpur Branch", toHubId: "hub", shipmentIds: ["final", "onward"], save: jest.fn() };
  jest.spyOn(Trip, "findOne").mockReturnValue({ session: async () => trip });
  const onward = { _id: "onward", lrDetails: { to: "Pune" }, save: jest.fn() };
  const chain = { populate: () => chain, session: async () => [{ _id: "final", lrDetails: { to: "Pune" }, pickupRequestId: { recipient: { city: "Nagpur" } } }, onward] };
  jest.spyOn(Shipment, "find").mockReturnValue(chain);
  const updates = jest.spyOn(Shipment, "updateMany").mockResolvedValue({});
  jest.spyOn(MovementLeg, "updateMany").mockResolvedValue({});
  jest.spyOn(PackageUnit, "updateMany").mockResolvedValue({});
  await arriveTrip("trip", req);
  expect(updates).toHaveBeenCalledWith({ _id: { $in: ["final"] } }, { $set: { currentLocation: "Nagpur", lastMileState: "ARRIVED" } }, { session });
  expect(onward.movementState).toBe("SORTING_PENDING");
  expect(onward.lastMileState).toBeUndefined();
});

function tallyContext(candidates) {
  jest.spyOn(Trip, "findOne").mockReturnValue({ session: async () => ({ _id: "trip", toHubId: "hub", destination: "Nagpur Branch", shipmentIds: candidates.map((row) => row._id) }) });
  jest.spyOn(UnloadingTally, "exists").mockReturnValue({ session: async () => false });
  const chain = { populate: () => chain, session: async () => candidates };
  jest.spyOn(Shipment, "find").mockReturnValue(chain);
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 1 });
  jest.spyOn(UnloadingTally, "create").mockImplementation(async ([data]) => [{ ...data, _id: "tally" }]);
  jest.spyOn(Shipment, "updateMany").mockResolvedValue({});
  jest.spyOn(ShipmentEvent, "create").mockResolvedValue([]);
}

test("Process Trip recovers legacy arrivals while excluding onward LRs and advanced Last Mile states", async () => {
  tallyContext([
    { _id: "legacy", lrDetails: { to: "Pune" }, pickupRequestId: { recipient: { city: "Nagpur" } }, packageCount: 26 },
    { _id: "onward", lrDetails: { to: "Pune" }, packageCount: 2 },
  ]);
  const tally = await createUnloadingTally({ tripId: "trip" }, req);
  expect(tally.shipmentIds).toEqual(["legacy"]);
  expect(tally.totalPackages).toBe(26);
  expect(Shipment.find).toHaveBeenCalledWith({ _id: { $in: ["legacy", "onward"] }, lastMileState: { $in: ["ARRIVED", null] } });
  expect(Shipment.updateMany).toHaveBeenCalledWith({ _id: { $in: ["legacy"] } }, { $set: { lastMileState: "UNLOADING", unloadingTallyId: "tally" } }, { session });
});

test("Process Trip still rejects trips containing only onward LRs", async () => {
  tallyContext([{ _id: "onward", lrDetails: { to: "Pune" }, packageCount: 2 }]);
  await expect(createUnloadingTally({ tripId: "trip" }, req)).rejects.toMatchObject({ errorCode: "NO_LAST_MILE_SHIPMENTS" });
  expect(UnloadingTally.create).not.toHaveBeenCalled();
});

test("verified trip closure publishes received LRs at the destination branch for DRS", async () => {
  const tally = { _id: "tally", tripId: "trip", branchId: "destination", status: "UNLOADING", shipmentIds: ["lr"], items: [{ shipmentId: "lr", expectedPackages: 3, receivedPackages: 0, scannedBarcodes: [] }], save: jest.fn() };
  jest.spyOn(UnloadingTally, "findById").mockReturnValue({ session: async () => tally });
  jest.spyOn(Trip, "findById").mockReturnValue({ session: async () => ({ _id: "trip", status: "ARRIVED", destination: "Yavatmal", shipmentIds: ["lr"], manifestIds: [], save: jest.fn() }) });
  jest.spyOn(Manifest, "find").mockReturnValue({ session: async () => [] });
  jest.spyOn(Manifest, "updateMany").mockResolvedValue({});
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [{ _id: "lr" }] });
  const update = jest.spyOn(Shipment, "updateMany").mockResolvedValue({});
  jest.spyOn(PackageUnit, "updateMany").mockResolvedValue({});
  jest.spyOn(MovementLeg, "updateMany").mockResolvedValue({});
  jest.spyOn(ShipmentEvent, "create").mockResolvedValue([]);
  await completeUnloadingTally("tally", { exceptions: [{ shipmentId: "lr", receivedPackages: 3, receiptRemarks: "Verified" }] }, req);
  expect(tally.status).toBe("INWARDED");
  expect(update).toHaveBeenCalledWith({ _id: { $in: ["lr"] } }, { $set: expect.objectContaining({ lastMileState: "DESTINATION_INWARDED", currentHubId: "destination", currentStatus: "RECEIVED" }) }, { session });
});
