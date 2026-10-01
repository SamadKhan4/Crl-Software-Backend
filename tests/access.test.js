import { jest } from "@jest/globals";
import { allow, permit } from "../src/middlewares/auth.js";
import { hasFullOperationsAccess } from "../src/utils/access.js";
import mongoose from "mongoose";
import { Shipment, Branch } from "../src/models/index.js";
import { hubInward, sortingInventory } from "../src/services/middle-mile.service.js";

afterEach(() => jest.restoreAllMocks());

test.each(["ADMIN", "MANAGER", "EMPLOYEE"])("%s sorting inventory applies the correct hub scope", async (role) => {
  const chain = {};
  for (const method of ["populate", "sort", "skip", "limit"]) chain[method] = jest.fn().mockReturnValue(chain);
  chain.lean = jest.fn().mockResolvedValue([]);
  const find = jest.spyOn(Shipment, "find").mockReturnValue(chain);
  jest.spyOn(Shipment, "countDocuments").mockResolvedValue(0);
  await sortingInventory({ page: 1, limit: 20 }, { role, branchId: "assigned-hub" });
  const filter = find.mock.calls[0][0];
  if (role === "EMPLOYEE") expect(filter.currentHubId).toBe("assigned-hub");
  else expect(filter).not.toHaveProperty("currentHubId");
  find.mockClear();
  await sortingInventory({ branchId: "assigned-hub" }, { role, branchId: "assigned-hub" });
  expect(find.mock.calls[0][0].currentHubId).toBe("assigned-hub");
});

test.each(["ADMIN", "MANAGER"])("%s has access despite restrictive module permissions", (role) => {
  const req = { user: { role, permissions: [{ module: "HUB", actions: ["VIEW"] }] } };
  const next = jest.fn();
  permit("HUB", "ADD", "EMPLOYEE")(req, {}, next);
  expect(next).toHaveBeenCalledWith();
  next.mockClear();
  allow("ADMIN")(req, {}, next);
  expect(next).toHaveBeenCalledWith();
  expect(hasFullOperationsAccess(req.user)).toBe(true);
});

test("employee module permissions and assigned-branch scope remain restricted", () => {
  const req = { user: { role: "EMPLOYEE", permissions: [{ module: "HUB", actions: ["VIEW"] }] } };
  const next = jest.fn();
  permit("HUB", "ADD", "EMPLOYEE")(req, {}, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  expect(hasFullOperationsAccess(req.user)).toBe(false);
});

test.each(["ADMIN", "MANAGER"])("%s can inward at a selected hub different from the LR origin", async (role) => {
  const session = { withTransaction: async (run) => run(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(Shipment, "findOne").mockReturnValue({ session: async () => ({ currentStatus: "BOOKED", originBranchId: "origin" }) });
  const boundary = new Error("active hub validation reached");
  jest.spyOn(Branch, "findOne").mockReturnValue({ session: async () => { throw boundary; } });
  await expect(hubInward({ branchId: "selected-hub", nextHubId: "next-hub", lrNumber: "LR001" }, { user: { role, branchId: "assigned-hub" } })).rejects.toBe(boundary);
  expect(session.endSession).toHaveBeenCalled();
});

test("employees cannot select a hub outside their assigned branch", async () => {
  await expect(hubInward({ branchId: "other-hub" }, { user: { role: "EMPLOYEE", branchId: "assigned-hub" } }))
    .rejects.toMatchObject({ statusCode: 403 });
});
