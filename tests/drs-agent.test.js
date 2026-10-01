import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { Shipment, User } from "../src/models/index.js";
import { createDrs } from "../src/services/last-mile.service.js";

afterEach(() => jest.restoreAllMocks());
test.each(["ADMIN", "MANAGER", "EMPLOYEE"])("%s uses the correct delivery-agent branch policy", async (role) => {
  const session = { withTransaction: async (run) => run(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [{ _id: "lr", destinationBranchId: "destination" }] });
  const boundary = new Error("agent lookup reached");
  const lookup = jest.spyOn(User, "findOne").mockReturnValue({ session: async () => { throw boundary; } });
  await expect(createDrs({ shipmentIds: ["lr"], branchId: "destination", deliveryAgentId: "agent" }, { user: { role, branchId: "destination" } })).rejects.toBe(boundary);
  expect(lookup).toHaveBeenCalledWith({ _id: "agent", role: "EMPLOYEE", status: "ACTIVE", ...(role === "EMPLOYEE" && { branchId: "destination" }) });
});
