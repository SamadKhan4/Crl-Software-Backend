import mongoose from "mongoose";
import { jest } from "@jest/globals";
import { Counter, AuditLog, Vendor, Shipment, PickupRequest, PickupRunSheet, Trip, Manifest, DeliveryRunSheet, TmsRegister } from "../src/models/index.js";
import { calculateVendorCommission, vendorSettlementWork, prepareVendorSettlement, createVendorSettlement, marketSettlementOptions } from "../src/services/vendor-settlement.service.js";

afterEach(() => jest.restoreAllMocks());
const lrs = [{ weightKg: 10, packageCount: 2 }, { weightKg: 20, packageCount: 3 }];
test.each([["PER_KG", 30], ["PER_BOX", 5], ["PER_TRIP", 2], ["FIXED", 1]])("calculates agreed master rate for %s", (basis, units) => {
  expect(calculateVendorCommission({ commercial: { rate: 12.5, rateBasis: basis } }, lrs, [{ type: "TRIP" }, { type: "PRS" }, { type: "MANIFEST" }, { type: "DRS" }])).toMatchObject({ units, commission: units * 12.5 });
});
test("empty work has no fixed charge", () => {
  expect(calculateVendorCommission({ commercial: { rate: 100, rateBasis: "FIXED" } }, [], []).commission).toBe(0);
});
const chain = (value) => ({ session: () => ({ lean: async () => value }) });
test('settles market operation at recorded cost with advance and excludes already settled operations', async () => {
  jest.spyOn(PickupRunSheet, 'find').mockReturnValue(chain([]));
  jest.spyOn(Trip, 'find').mockReturnValue(chain([{ _id: 'trip', tripNumber: 'MV1', vehicleNumber: 'MH31AB1234', branchId: 'branch', shipmentIds: ['lr'], freightAmount: 500, advanceAmount: 100, status: 'CLOSED' }]));
  const previous = jest.spyOn(TmsRegister, 'find').mockReturnValue(chain([]));
  jest.spyOn(Shipment, 'find').mockReturnValue(chain([{ _id: 'lr', lrNumber: 'LR1', weightKg: 10 }]));
  const data = { metadata: { settlementType: 'MARKET', marketOperationKey: 'TRIP:trip', tds: 10 } };
  const payload = await prepareVendorSettlement(data, { role: 'ADMIN' });
  expect(payload).toMatchObject({ amount: 390, branchId: 'branch', vehicleNumber: 'MH31AB1234', metadata: { settlementType: 'MARKET', commission: 500, advance: 100, deductions: 110 } });
  expect(payload.vendorId).toBeUndefined();
  previous.mockReturnValue(chain([{ metadata: { operations: [{ key: 'TRIP:trip' }] } }]));
  expect(await marketSettlementOptions({ role: 'ADMIN' })).toEqual([]);
  await expect(prepareVendorSettlement(data, { role: 'ADMIN' })).rejects.toMatchObject({ errorCode: 'NO_MARKET_WORK' });
});
test('blocks market settlement with unapproved rates', async () => {
  jest.spyOn(PickupRunSheet, 'find').mockReturnValue(chain([{ _id: 'prs', prsNumber: 'PRS1', approvalStatus: 'PENDING', status: 'PENDING_APPROVAL', vendorPayableAmount: 100 }]));
  jest.spyOn(Trip, 'find').mockReturnValue(chain([]));
  jest.spyOn(TmsRegister, 'find').mockReturnValue(chain([]));
  jest.spyOn(Shipment, 'find').mockReturnValue(chain([]));
  await expect(prepareVendorSettlement({ metadata: { settlementType: 'MARKET', marketOperationKey: 'PRS:prs' } }, { role: 'ADMIN' })).rejects.toMatchObject({ errorCode: 'VENDOR_RATE_APPROVAL_REQUIRED' });
});
function mockWork(previous = []) {
  jest.spyOn(Vendor, "findById").mockReturnValue(chain({ _id: "vendor", vendorCode: "V001", name: "Vendor", status: "ACTIVE", commercial: { rate: 2, rateBasis: "PER_KG" } }));
  jest.spyOn(PickupRunSheet, "find").mockReturnValue(chain([{ _id: "prs", prsNumber: "PRS1", branchId: "branch", shipmentIds: ["lr1"], vendorPayableAmount: 100, status: "DISPATCHED" }]));
  jest.spyOn(Trip, "find").mockReturnValue(chain([{ _id: "trip", tripNumber: "TRIP1", branchId: "branch", shipmentIds: ["lr1", "lr2"], freightAmount: 500, advanceAmount: 10, status: "CLOSED" }]));
  jest.spyOn(Manifest, "find").mockReturnValue(chain([]));
  jest.spyOn(DeliveryRunSheet, "find").mockReturnValue(chain([]));
  jest.spyOn(PickupRequest, "find").mockReturnValue(chain([]));
  jest.spyOn(TmsRegister, "find").mockImplementation((where) => chain(where.module === "VENDOR_SETTLEMENT" ? previous : []));
  jest.spyOn(Shipment, "find").mockReturnValue(chain([{ _id: "lr1", lrNumber: "LR1", weightKg: 10, packageCount: 2, lrDetails: { freightCharges: 100 } }, { _id: "lr2", lrNumber: "LR2", weightKg: 20, packageCount: 3, lrDetails: { freightCharges: 200 } }]));
}
test("deduplicates LRs across trip and PRS and keeps recorded costs separate", async () => {
  mockWork();
  const work = await vendorSettlementWork("vendor", { role: "MANAGER" });
  expect(Shipment.find).toHaveBeenCalledWith(expect.objectContaining({ _id: { $in: ["lr1", "lr2"] } }));
  expect(work.calculation.commission).toBe(60);
  expect(work.advance).toBe(10);
  expect(work.operations).toHaveLength(2);
});
test("saves master commission, LR/operation snapshots and correct deductions", async () => {
  mockWork();
  const payload = await prepareVendorSettlement({ vendorId: "vendor", metadata: { baseAmount: 99999, commission: 99999, loading: 5, tds: 2 } }, { role: "MANAGER" });
  expect(payload).toMatchObject({ branchId: "branch", amount: 53, taxAmount: 0, shipmentIds: ["lr1", "lr2"], metadata: { commission: 60, baseAmount: 60, gross: 65, advance: 10, tds: 2, deductions: 12, payable: 53 } });
  expect(payload.metadata.lrDetails).toHaveLength(2);
});
test("excludes previously settled work for the same vendor", async () => {
  mockWork([{ shipmentIds: ["lr1"], metadata: { operations: [{ key: "PRS:prs" }] } }]);
  const work = await vendorSettlementWork("vendor", { role: "MANAGER" });
  expect(work.shipments.map((row) => row.id)).toEqual(["lr2"]);
  expect(work.operations.map((row) => row.type)).toEqual(["TRIP"]);
  expect(work.calculation.commission).toBe(40);
});
test("rejects invalid deductions instead of hiding an overpayment", async () => {
  mockWork();
  await expect(prepareVendorSettlement({ vendorId: "vendor", metadata: { tds: 100 } }, { role: "MANAGER" })).rejects.toMatchObject({ errorCode: "DEDUCTIONS_EXCEED_GROSS" });
});


test("creates the settlement and audit in a transaction with a vendor lock", async () => {
  mockWork();
  const session = { withTransaction: jest.fn(async (work) => work()), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  const lock = jest.spyOn(Vendor, "updateOne").mockResolvedValue({ matchedCount: 1 });
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 1 });
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  const create = jest.spyOn(TmsRegister, "create").mockImplementation(async ([data]) => [{ ...data, _id: "settlement", toObject: () => data }]);
  const result = await createVendorSettlement({ vendorId: "vendor", title: "Commission", operationDate: new Date() }, { user: { _id: "manager", role: "MANAGER" }, get: () => "test" });
  expect(lock).toHaveBeenCalledWith({ _id: "vendor" }, { $inc: { __v: 1 } }, { session });
  expect(create).toHaveBeenCalledWith([expect.objectContaining({ module: "VENDOR_SETTLEMENT", amount: 50, branchId: "branch" })], { session });
  expect(result.id).toBe("settlement");
  expect(session.endSession).toHaveBeenCalledTimes(1);
});


test("provides editable title, reference, dates and zero defaults with recorded advance", async () => {
  mockWork();
  const { defaults } = await vendorSettlementWork("vendor", { role: "MANAGER" });
  expect(defaults).toMatchObject({ title: "Commission settlement - V001 - Vendor", reference: "PRS1, TRIP1", metadata: { detention: 0, loading: 0, otherCharge: 0, tds: 0, advance: 10 } });
  expect(defaults.documentNumber).toMatch(/^VCOM-V001-/);
  expect(defaults.operationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(defaults.dueDate).toBe(defaults.operationDate);
});
