import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { AuditLog, Counter, DeliveryRunSheet, Manifest, PackageUnit, Shipment, ShipmentEvent, Vendor } from "../src/models/index.js";
import { createDrs, drsInventory, closeDrs } from "../src/services/last-mile.service.js";

const req = { user: { role: "ADMIN", _id: "admin", branchId: "branch" }, get: () => "test" };
const data = { branchId: "branch", vendorId: "vendor", vehicleSource: "VV", shipmentIds: ["lr"], vehicleNumber: "MH31AB1234", driverName: "Driver", deliveryDate: new Date() };
let session;
beforeEach(() => {
  session = { withTransaction: async (run) => run(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
});
afterEach(() => jest.restoreAllMocks());

test("inventory scopes admins to the selected branch and excludes delivered or assigned LRs", async () => {
  const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
  const find = jest.spyOn(Shipment, "find").mockReturnValue(chain);
  jest.spyOn(Shipment, "countDocuments").mockResolvedValue(0);
  await drsInventory({ branchId: "other-branch", search: "LR001" }, req.user);
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ currentHubId: "other-branch", currentStatus: "RECEIVED", lastMileState: "DESTINATION_INWARDED", activeDrsId: { $exists: false } }));
});

function setup(shipments = [{ _id: "lr" }], vendor = { _id: "vendor", vendorType: "LAST_MILE", vehicles: [{ vehicleNumber: "MH31AB1234", driverName: "Mapped Driver", driverMobile: "9876543210", status: "ACTIVE" }] }) {
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => shipments });
  jest.spyOn(Vendor, "findOne").mockReturnValue({ session: async () => vendor });
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 1 });
  jest.spyOn(DeliveryRunSheet, "create").mockImplementation(async ([row]) => [{ ...row, _id: "drs" }]);
  jest.spyOn(Shipment, "updateMany").mockResolvedValue({ modifiedCount: 1 });
  jest.spyOn(PackageUnit, "updateMany").mockResolvedValue({});
  jest.spyOn(ShipmentEvent, "create").mockResolvedValue([]);
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
}

test("creates DRS from selected LRs and chosen vendor without manifest, route or delivery agent", async () => {
  setup();
  const manifest = jest.spyOn(Manifest, "findById");
  const result = await createDrs(data, req);
  expect(manifest).not.toHaveBeenCalled();
  expect(result).toMatchObject({ branchId: "branch", vendorId: "vendor", vehicleSource: "VV", shipmentIds: ["lr"], workflowStatus: "DISPATCHED" });
  expect(result.driverName).toBe("Mapped Driver");
  expect(result.driverMobile).toBe("9876543210");
  expect(result.route).toBeUndefined();
  expect(result.deliveryAgentId).toBeUndefined();
  expect(Shipment.find).toHaveBeenCalledWith(expect.objectContaining({ currentHubId: "branch", _id: { $in: ["lr"] }, activeDrsId: { $exists: false } }));
});

test("rejects stale or cross-branch LR selections", async () => {
  setup([]);
  await expect(createDrs(data, req)).rejects.toMatchObject({ errorCode: "DRS_INVENTORY_CHANGED" });
  expect(DeliveryRunSheet.create).not.toHaveBeenCalled();
});

test("rejects vendor mismatches for market vehicles", async () => {
  setup(undefined, null);
  await expect(createDrs({ ...data, vehicleSource: "MV" }, req)).rejects.toMatchObject({ errorCode: "INVALID_DRS_VENDOR" });
  expect(Vendor.findOne).toHaveBeenCalledWith(expect.objectContaining({ $or: [{ vendorType: "MARKET" }, { hasMarketVehicles: true }] }));
});

test("rejects concurrent assignment of an LR", async () => {
  setup();
  Shipment.updateMany.mockResolvedValue({ modifiedCount: 0 });
  await expect(createDrs(data, req)).rejects.toMatchObject({ errorCode: "DRS_ASSIGNMENT_RACE" });
});

test("rejects a vehicle that is not mapped to the selected vendor", async () => {
  setup();
  await expect(createDrs({ ...data, vehicleNumber: "MH31XX9999" }, req)).rejects.toMatchObject({ errorCode: "INVALID_VENDOR_VEHICLE" });
  expect(DeliveryRunSheet.create).not.toHaveBeenCalled();
});

test("closure requires POD for every delivered LR", async () => {
  jest.spyOn(DeliveryRunSheet, "findById").mockReturnValue({ session: async () => ({ _id: "drs", status: "OPEN", workflowStatus: "CLOSURE_PENDING", items: [{ shipmentId: "lr", attemptStatus: "DELIVERED" }], podShipmentIds: [] }) });
  await expect(closeDrs("drs", req)).rejects.toMatchObject({ errorCode: "POD_INCOMPLETE" });
});

 test.each([['PER_TRIP', 125, 125], ['PER_KG', 10, 250], ['PER_BOX', 20, 60]])('snapshots mapped %s vendor charges', async (rateBasis, rate, expected) => {
  setup([{ _id: "lr", weightKg: 25, packageCount: 3 }], { _id: "vendor", vendorType: "LAST_MILE", commercial: { rateBasis, rate }, vehicles: [{ vehicleNumber: data.vehicleNumber, driverName: "Driver", status: "ACTIVE" }] });
  const result = await createDrs({ ...data, vendorCharges: 9999 }, req);
  expect(result).toMatchObject({ vendorCharges: expected, vendorRate: rate, vendorRateBasis: rateBasis });
});
test('requires and saves manually entered market charges', async () => {
  setup([{ _id: "lr" }], { _id: "vendor", vendorType: "MARKET", vehicles: [{ vehicleNumber: data.vehicleNumber, driverName: "Driver", status: "ACTIVE" }] });
  await expect(createDrs({ ...data, vehicleSource: "MV" }, req)).rejects.toMatchObject({ errorCode: "DRS_CHARGES_REQUIRED" });
  expect(await createDrs({ ...data, vehicleSource: "MV", vendorCharges: 450 }, req)).toMatchObject({ vendorCharges: 450, vendorRateBasis: "FIXED" });
});

test("creates DRS for a mapped vehicle without driver name or mobile", async () => {
  setup(undefined, { _id: "vendor", vendorType: "LAST_MILE", vehicles: [{ vehicleNumber: data.vehicleNumber, status: "ACTIVE" }] });
  const { driverName, ...withoutDriver } = data;
  const result = await createDrs(withoutDriver, req);
  expect(result.driverName).toBeUndefined();
  expect(result.driverMobile).toBeUndefined();
});
