import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { Branch, BusinessMaster, PickupRequest, Shipment, Manifest, LoadingTally, Segregation, PackageUnit, Trip, MovementLeg, ShipmentEvent, Counter, AuditLog } from "../src/models/index.js";
import { sortingInventory, createSorting, createLoadingTally, createTrip, createManifest } from "../src/services/middle-mile.service.js";

beforeEach(() => {
  jest.spyOn(PickupRequest, "find").mockReturnValue({ select: () => ({ session: async () => [] }) });
});
afterEach(() => jest.restoreAllMocks());
const req = { user: { role: "ADMIN", _id: "admin" } };
function transaction() {
  const session = { withTransaction: jest.fn(async (work) => work()), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  return session;
}
test("sorting inventory filters destination city and PIN without depending on pickup completion", async () => {
  jest.spyOn(PickupRequest, "distinct").mockReturnValue({ session: async () => ["pending-pickup"] });
  const chain = { populate: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
  jest.spyOn(Branch, "find").mockReturnValue({ session: async () => [{ _id: "mumbai-branch" }] });
  const find = jest.spyOn(Shipment, "find").mockReturnValue(chain);
  jest.spyOn(Shipment, "countDocuments").mockResolvedValue(0);
  await sortingInventory({ destination: "Mumbai", destinationPincode: "400001" }, req.user);
  const filter = find.mock.calls[0][0];
  expect(filter["lrDetails.consigneePincode"]).toBe("400001");
  expect(filter.$and[0].$or[1].$or[0]["lrDetails.to"].test("mumbai")).toBe(true);
  expect(filter.$and[0].$or[1].$or[0]["lrDetails.to"].test("Pune")).toBe(false);
  expect(filter).not.toHaveProperty("pickupRequestId");
  expect(PickupRequest.distinct).not.toHaveBeenCalled();
  expect(filter.$and[0].$or[1].$or[1]).toEqual({ "lrDetails.to": { $in: [null, ""] }, destinationBranchId: { $in: ["mumbai-branch"] } });
  expect(filter.routeId).toBeUndefined();
});
test("city sorting rejects LRs outside its city/PIN selection without assigning a route", async () => {
  jest.spyOn(Branch, "findOne").mockResolvedValue({ _id: "office", city: "Nagpur" });
  transaction();
  jest.spyOn(PickupRequest, "distinct").mockReturnValue({ session: async () => [] });
  const find = jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [] });
  jest.spyOn(Branch, "find").mockReturnValue({ session: async () => [] });
  const route = jest.spyOn(BusinessMaster, "findOne");
  await expect(createSorting({ destination: "Mumbai", destinationPincode: "400001", shipmentIds: ["lr"] }, req)).rejects.toMatchObject({ errorCode: "INVALID_SHIPMENT_SELECTION" });
  expect(find.mock.calls[0][0]["lrDetails.consigneePincode"]).toBe("400001");
  expect(route).not.toHaveBeenCalled();
});
test("city tally accepts a route-free batch and still rejects unavailable sorted LRs", async () => {
  transaction();
  jest.spyOn(Branch, "findOne").mockResolvedValue({ _id: "office", city: "Nagpur" });
  const batch = jest.spyOn(Segregation, "findOne").mockReturnValue({ session: async () => ({ _id: "batch", destination: "Mumbai", shipmentIds: ["lr"] }) });
  jest.spyOn(LoadingTally, "exists").mockReturnValue({ session: async () => false });
  const find = jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [] });
  await expect(createLoadingTally({ segregationId: "batch", vehicleCapacityKg: 1000 }, req)).rejects.toMatchObject({ errorCode: "INVALID_SHIPMENT_SELECTION" });
  expect(batch.mock.calls[0][0]).not.toHaveProperty("routeId");
  expect(find.mock.calls[0][0]).not.toHaveProperty("routeId");
});
test("trip rejects a selected route whose destination differs from the manifest city", async () => {
  transaction();
  jest.spyOn(Manifest, "find").mockReturnValue({ session: async () => [{ _id: "manifest", origin: "Nagpur", destination: "Mumbai" }] });
  jest.spyOn(BusinessMaster, "findOne").mockReturnValue({ session: async () => ({ _id: "route", origin: "Nagpur", destination: "Pune" }) });
  await expect(createTrip({ routeId: "route", destination: "Mumbai", manifestIds: ["manifest"] }, req)).rejects.toMatchObject({ errorCode: "ROUTE_DESTINATION_MISMATCH" });
});

function manifestContext(value) {
  transaction();
  jest.spyOn(LoadingTally, "findOne").mockReturnValue({ session: async () => ({ _id: "tally", shipmentIds: ["lr"], toHubId: "office" }) });
  jest.spyOn(Manifest, "exists").mockReturnValue({ session: async () => false });
  jest.spyOn(Branch, "findById").mockReturnValue({ session: async () => ({ city: "Mumbai" }) });
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [{ _id: "lr", lrNumber: "LR001", movementState: "LOADING_TALLY_COMPLETED", lrDetails: { declaredValue: value } }] });
  jest.spyOn(PackageUnit, "exists").mockReturnValue({ session: async () => false });
}
test("manifest requires an E-way number for an LR above 50000", async () => {
  manifestContext(50001);
  await expect(createManifest({ loadingTallyId: "tally", verifiedShipmentIds: ["lr"] }, req)).rejects.toMatchObject({ errorCode: "EWAY_NUMBER_REQUIRED" });
});
test.each([49999, 50000])("manifest rejects E-way updates at goods value %s", async (value) => {
  manifestContext(value);
  await expect(createManifest({ loadingTallyId: "tally", verifiedShipmentIds: ["lr"], eWayUpdates: [{ shipmentId: "lr", eWayBillNo: "271234567890" }] }, req)).rejects.toMatchObject({ errorCode: "INVALID_EWAY_UPDATE" });
});


test("sorting uses receiver Yavatmal rather than a stale Nagpur LR destination, without PRS", async () => {
  PickupRequest.find.mockReturnValue({ select: () => ({ session: async () => [{ _id: "pur", recipient: { city: "Yavatmal" } }] }) });
  jest.spyOn(Branch, "find").mockReturnValue({ session: async () => [] });
  const lr = { _id: "lr", lrNumber: "CRL20281P2444", lrDetails: { to: "Nagpur" }, pickupRequestId: { _id: "pur", recipient: { city: "Yavatmal" } } };
  const chain = { populate: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [lr] };
  const find = jest.spyOn(Shipment, "find").mockReturnValue(chain);
  jest.spyOn(Shipment, "countDocuments").mockResolvedValue(1);
  const result = await sortingInventory({ destination: "Yavatmal" }, req.user);
  expect(find.mock.calls[0][0].$and[0].$or[0]).toEqual({ pickupRequestId: { $in: ["pur"] } });
  expect(find.mock.calls[0][0].$and[0].$or[1].pickupRequestId).toEqual({ $nin: ["pur"] });
  expect(result.items[0].sortingDestination).toBe("Yavatmal");
  await sortingInventory({ destination: "Nagpur" }, req.user);
  expect(find.mock.calls[1][0].$and[0].$or[0]).toEqual({ pickupRequestId: { $in: [] } });
});


test.each(["route", undefined])("trip creation dispatches manifests and LRs with route %s", async (routeId) => {
  const session = transaction();
  const manifest = { _id: "manifest", origin: "Nagpur", destination: "Yavatmal", branchId: "hub", fromHubId: "hub", toHubId: "dest", shipmentIds: ["lr"], totalLrs: 1, totalPackages: 20, totalWeightKg: 200 };
  jest.spyOn(Manifest, "find").mockReturnValue({ session: async () => [manifest] });
  jest.spyOn(BusinessMaster, "findOne").mockReturnValue({ session: async () => ({ _id: "route", origin: "Nagpur", destination: "Yavatmal" }) });
  jest.spyOn(Branch, "findById").mockReturnValue({ session: async () => ({ city: "Nagpur" }) });
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 1 });
  const save = jest.fn();
  jest.spyOn(Trip, "create").mockImplementation(async ([data]) => [{ ...data, _id: "trip", save }]);
  const manifests = jest.spyOn(Manifest, "updateMany").mockResolvedValue({ modifiedCount: 1 });
  const shipments = jest.spyOn(Shipment, "updateMany").mockResolvedValue({ modifiedCount: 1 });
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [{ _id: "lr" }] });
  jest.spyOn(MovementLeg, "updateMany").mockResolvedValue({ modifiedCount: 1 });
  const events = jest.spyOn(ShipmentEvent, "create").mockResolvedValue([]);
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  const result = await createTrip({ routeId, destination: "Yavatmal", manifestIds: ["manifest"], vehicleSource: "MV", vehicleNumber: "MH31AB1234", driverName: "Driver" }, { ...req, get: () => "test" });
  expect(result).toMatchObject({ status: "DISPATCHED", workflowStatus: "IN_TRANSIT", dispatchedAt: expect.any(Date) });
  expect(save).toHaveBeenCalledWith({ session });
  expect(manifests).toHaveBeenCalledWith(expect.anything(), { $set: { workflowStatus: "DISPATCHED" } }, { session });
  expect(shipments).toHaveBeenCalledWith(expect.anything(), { $set: { currentStatus: "IN_TRANSIT", movementState: "IN_TRANSIT", currentLocation: "In transit: Nagpur to Yavatmal" } }, { session });
  expect(events).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ status: "IN_TRANSIT", tripId: "trip" })]), { session, ordered: true });
  expect(session.withTransaction).toHaveBeenCalledTimes(1);
});
