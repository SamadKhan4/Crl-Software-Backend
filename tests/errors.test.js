import { jest } from "@jest/globals";
import { errorHandler } from "../src/middlewares/errors.js";

test("reports standalone MongoDB transaction failures as actionable service errors", () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorHandler(
    Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 }),
    { id: "test-request" },
    res,
    () => {},
  );
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      success: false,
      errorCode: "DATABASE_TRANSACTIONS_UNAVAILABLE",
      requestId: "test-request",
    }),
  );
});

test("does not expose unrelated internal errors", () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorHandler(Object.assign(new Error("Private database detail"), { code: 20 }), {}, res, () => {});
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Internal server error" }));
});
