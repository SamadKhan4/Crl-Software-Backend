import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { Branch, BusinessMaster, PickupRequest, Shipment, Manifest, LoadingTally, Segregation } from "../src/models/index.js";
import { sortingInventory, createSorting, createLoadingTally, createTrip } from "../src/services/middle-mile.service.js";

afterEach(() => jest.restoreAllMocks());
const req = { user: { role: "ADMIN", _id: "admin" } };
function transaction() {
  const session = { withTransaction: jest.fn(async (work) => work()), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  return session;
}
test("sorting inventory filters destination city and PIN while excluding unfinished pickups", async () => {
  jest.spyOn(PickupRequest, "distinct").mockReturnValue({ session: async () => ["pending-pickup"] });
  const chain = { populate: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
  const find = jest.spyOn(Shipment, "find").mockReturnValue(chain);
  jest.spyOn(Shipment, "countDocuments").mockResolvedValue(0);
  await sortingInventory({ destination: "Mumbai", destinationPincode: "400001" }, req.user);
  const filter = find.mock.calls[0][0];
  expect(filter["lrDetails.consigneePincode"]).toBe("400001");
  expect(filter.$and[0]["lrDetails.to"].test("mumbai")).toBe(true);
  expect(filter.$and[0]["lrDetails.to"].test("Pune")).toBe(false);
  expect(filter.pickupRequestId.$nin).toEqual(["pending-pickup"]);
  expect(filter.routeId).toBeUndefined();
});
test("city sorting rejects LRs outside its city/PIN selection without assigning a route", async () => {
  jest.spyOn(Branch, "findOne").mockResolvedValue({ _id: "office", city: "Nagpur" });
  transaction();
  jest.spyOn(PickupRequest, "distinct").mockReturnValue({ session: async () => [] });
  const find = jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [] });
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
