import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { AuditLog, Counter, PickupRequest, PickupRunSheet, Shipment, Notification, User, Vendor } from "../src/models/index.js";
import { createPickupRunSheet, reviewMarketRate } from "../src/services/pickup-run-sheet.service.js";

afterEach(() => jest.restoreAllMocks());

const data = { marketPickupRequestId: "pickup", fieldExecutiveId: "fe", vehicleNumber: "MH31AB1234", rateSource: "MARKET" };
const req = { user: { role: "ADMIN" } };
const pickup = { agentAssignment: { vehicleNumber: data.vehicleNumber } };
const fe = { branchId: "branch-a", mobile: "9876543210" };

test("branch-less market pickup reaches transaction creation using the selected FE branch", async () => {
  jest.spyOn(PickupRequest, "findOne").mockResolvedValue(pickup);
  jest.spyOn(User, "findOne").mockResolvedValue(fe);
  const boundary = new Error("transaction boundary reached");
  const session = jest.spyOn(mongoose, "startSession").mockRejectedValue(boundary);
  await expect(createPickupRunSheet(data, req)).rejects.toBe(boundary);
  expect(session).toHaveBeenCalledTimes(1);
});

test("market pickup from another branch allows the selected FE", async () => {
  jest.spyOn(PickupRequest, "findOne").mockResolvedValue({ ...pickup, branchId: "branch-b" });
  jest.spyOn(User, "findOne").mockResolvedValue(fe);
  const boundary = new Error("transaction boundary reached");
  jest.spyOn(mongoose, "startSession").mockRejectedValue(boundary);
  await expect(createPickupRunSheet(data, req)).rejects.toBe(boundary);
});

function mockCreation(overrides = {}) {
  const session = { withTransaction: jest.fn(async (work) => work()), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(User, "findOne").mockResolvedValue({ ...fe, _id: "fe", name: "Field Executive" });
  jest.spyOn(Vendor, "findOne").mockResolvedValue({ _id: "vendor", vendorCode: "V01", name: "Vendor", commercial: { rate: 10, rateBasis: "PER_KG" }, vehicles: [{ vehicleNumber: data.vehicleNumber, vehicleType: "Truck" }] });
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 1 });
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  const sheet = { _id: "sheet", pickupRequestIds: [], shipmentIds: [], purEntries: [], totalBoxes: 0, totalWeightKg: 0, save: jest.fn() };
  jest.spyOn(PickupRunSheet, "create").mockImplementation(async ([fields]) => [Object.assign(sheet, fields)]);
  const pickupRecord = { _id: "pickup", branchId: "branch-a", shipmentId: "shipment", status: "PENDING", totalBoxes: 3, totalWeightKg: 20, agentAssignment: { sourceType: "VENDOR", vendorId: "vendor" }, save: jest.fn(), ...overrides };
  jest.spyOn(PickupRequest, "find").mockReturnValue({ session: async () => [pickupRecord] });
  jest.spyOn(Shipment, "findById").mockReturnValue({ populate: () => ({ session: async () => ({ _id: "shipment", lrNumber: "LR001", packageCount: 3, weightKg: 20, senderName: "Client", lrDetails: { paymentMode: "TO_PAY", totalAmount: 750, to: "Pune" } }) }) });
  jest.spyOn(Notification, "create").mockResolvedValue([]);
  jest.spyOn(PickupRequest, "findById").mockReturnValue({ session: async () => pickupRecord });
  const payload = { vendorId: "vendor", fieldExecutiveId: "fe", vehicleNumber: data.vehicleNumber, rateSource: "MASTER", vendorCategory: "TRANSPORTER", route: "Nagpur - Pune", pickups: [{ pickupRequestId: "pickup", paymentTerm: "PAID", amount: 250 }] };
  return { session, sheet, pickupRecord, payload, request: { user: { _id: "admin", role: "ADMIN" }, get: () => "test" } };
}

test("creates PRS with LR entries, totals and pickup assignment in one transaction", async () => {
  const { session, sheet, pickupRecord, payload, request } = mockCreation();
  const result = await createPickupRunSheet(payload, request);
  expect(result.pickupRequestIds).toEqual(["pickup"]);
  expect(result.purEntries).toEqual([expect.objectContaining({ shipmentId: "shipment", paymentTerm: "TO_PAY", amount: 750 })]);
  expect(result).toMatchObject({ status: "DISPATCHED", totalBoxes: 3, totalWeightKg: 20, vendorPayableAmount: 200 });
  expect(pickupRecord.pickupRunSheetId).toBe("sheet");
  expect(sheet.save).toHaveBeenCalledWith({ session });
  expect(pickupRecord.save).toHaveBeenCalledWith({ session });
  expect(session.withTransaction).toHaveBeenCalledTimes(1);
  expect(session.endSession).toHaveBeenCalledTimes(1);
});

test.each([
  [{ agentAssignment: { sourceType: "VENDOR", vendorId: "other-vendor" } }, "PRS_VENDOR_MISMATCH"],
  [{ pickupRunSheetId: "existing-sheet" }, "PICKUP_REQUEST_NOT_ELIGIBLE"],
  [{ shipmentId: null }, "PICKUP_LR_REQUIRED"],
])("rejects unavailable or mismatched LRs before assigning them: %s", async (overrides, errorCode) => {
  const { session, pickupRecord, payload, request } = mockCreation(overrides);
  await expect(createPickupRunSheet(payload, request)).rejects.toMatchObject({ errorCode });
  expect(pickupRecord.save).not.toHaveBeenCalled();
  expect(session.endSession).toHaveBeenCalledTimes(1);
});

test("allows an FE from another branch while keeping PRS in the LR branch", async () => {
  const { payload, request, pickupRecord } = mockCreation({ branchId: "lr-branch" });
  const result = await createPickupRunSheet(payload, request);
  expect(result).toMatchObject({ branchId: "lr-branch", fieldExecutiveId: "fe", status: "DISPATCHED" });
  expect(pickupRecord.branchId).toBe("lr-branch");
});

test("branch operator may assign another branch FE to their own LR", async () => {
  const { payload, request } = mockCreation({ branchId: "operator-branch" });
  request.user = { _id: "operator", role: "EMPLOYEE", branchId: "operator-branch" };
  const result = await createPickupRunSheet(payload, request);
  expect(result).toMatchObject({ branchId: "operator-branch", fieldExecutiveId: "fe", status: "DISPATCHED" });
});

test("operator can attach an eligible LR regardless of office", async () => {
  const { payload, request, pickupRecord } = mockCreation({ branchId: "other-branch" });
  request.user = { _id: "operator", role: "EMPLOYEE", branchId: "operator-branch" };
  await expect(createPickupRunSheet(payload, request)).resolves.toMatchObject({ status: "DISPATCHED", shipmentIds: ["shipment"] });
  expect(pickupRecord.save).toHaveBeenCalled();
});

test("inherits route from agent alignment without a PRS route input and preserves it", async () => {
  const { payload, request, pickupRecord } = mockCreation({ agentAssignment: { sourceType: "VENDOR", vendorId: "vendor", route: "Nagpur Express" } });
  delete payload.route;
  const result = await createPickupRunSheet(payload, request);
  expect(result.route).toBe("Nagpur Express");
  expect(pickupRecord.agentAssignment.route).toBe("Nagpur Express");
});

test("market PRS dispatches immediately while rate review remains pending", async () => {
  const { payload, request } = mockCreation();
  const result = await createPickupRunSheet({ ...payload, rateSource: "MARKET", marketAmount: 1500 }, request);
  expect(result).toMatchObject({ status: "DISPATCHED", approvalStatus: "PENDING", vendorPayableAmount: 1500 });
  expect(result.dispatchId).toBeDefined();
});

test.each(["APPROVED", "REJECTED"])("rate review %s preserves an already dispatched PRS", async (decision) => {
  const sheet = { _id: "sheet", status: "DISPATCHED", rateSource: "MARKET", approvalStatus: "PENDING", pickupRequestIds: ["pickup"], save: jest.fn() };
  jest.spyOn(PickupRunSheet, "findById").mockResolvedValue(sheet);
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  const result = await reviewMarketRate("sheet", { decision, remarks: "Rate checked" }, { user: { _id: "manager", role: "MANAGER" }, get: () => "test" });
  expect(result).toMatchObject({ status: "DISPATCHED", approvalStatus: decision });
});
