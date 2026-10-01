import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { PickupRequest, User } from "../src/models/index.js";
import { createPickupRunSheet } from "../src/services/pickup-run-sheet.service.js";

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

test("market pickup assigned to another branch still rejects the FE", async () => {
  jest.spyOn(PickupRequest, "findOne").mockResolvedValue({ ...pickup, branchId: "branch-b" });
  jest.spyOn(User, "findOne").mockResolvedValue(fe);
  const session = jest.spyOn(mongoose, "startSession");
  await expect(createPickupRunSheet(data, req)).rejects.toMatchObject({ errorCode: "INVALID_MARKET_PICKUP_BRANCH" });
  expect(session).not.toHaveBeenCalled();
});
