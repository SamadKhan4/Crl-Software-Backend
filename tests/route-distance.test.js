import { jest } from "@jest/globals";
import { AuditLog, BusinessMaster } from "../src/models/index.js";
import { createMaster, updateMaster } from "../src/services/expansion.service.js";
const req = { user: { _id: "admin", role: "ADMIN" }, get: () => "test" };
afterEach(() => jest.restoreAllMocks());
test("saves the manually entered route distance without requesting Maps", async () => {
  const fetch = jest.spyOn(global, "fetch");
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  const create = jest.spyOn(BusinessMaster, "create").mockImplementation(async (data) => ({ _id: "route", ...data, toObject: () => data }));
  const result = await createMaster({ type: "ROUTE", code: "RTE01", name: "Nagpur Mumbai", origin: "Nagpur", destination: "Mumbai", distanceKm: 812.5 }, req);
  expect(result).toMatchObject({ distanceKm: 812.5, distanceStatus: "MANUAL" });
  expect(create).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
test("allows a previously pending distance to be entered manually", async () => {
  const record = { _id: "route", type: "ROUTE", distanceStatus: "NOT_CONFIGURED", save: jest.fn(), toObject() { return { distanceKm: this.distanceKm, distanceStatus: this.distanceStatus }; } };
  jest.spyOn(BusinessMaster, "findOne").mockResolvedValue(record);
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  const result = await updateMaster("route", { distanceKm: 825 }, req);
  expect(result).toMatchObject({ distanceKm: 825, distanceStatus: "MANUAL" });
  expect(record.save).toHaveBeenCalled();
});
