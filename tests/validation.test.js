import request from "supertest";
import { createApp } from "../src/app.js";
import { shipmentSchema } from "../src/validators/schemas.js";
describe("HTTP validation", () => {
  const app = createApp();
  test("health check responds", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
  test("blocks unvalidated login data", async () => {
    const response = await request(app).post("/api/auth/login").send({ email: "bad" });
    expect(response.status).toBe(422);
    expect(response.body.errorCode).toBe("VALIDATION_ERROR");
  });
  test("protects internal routes", async () => {
    const response = await request(app).get("/api/customers");
    expect(response.status).toBe(401);
  });
  test("strictly validates supplied print-only LR details", () => {
    const base = {
      lrNumber: "123",
      customerId: "66d8f14124b86f067a916602",
      originBranchId: "66d8f14124b86f067a916601",
      destinationBranchId: "66d8f14124b86f067a916603",
      senderName: "Sender Name",
      receiverName: "Receiver Name",
      packageCount: 1,
      weightKg: 1,
    };
    expect(
      shipmentSchema.safeParse({
        ...base,
        lrDetails: {
          consignorPincode: "440016",
          consignorGstin: "27ABCDE1234F1Z5",
          bookingDate: "2026-09-10T09:30:00.000Z",
          contactNo: "+919876543210",
          actualWeight: 1,
          paymentMode: "PAID",
        },
      }).success,
    ).toBe(true);
    for (const lrDetails of [
      { consignorPincode: "44001" },
      { consigneeGstin: "not-a-gstin" },
      { bookingDate: "not-a-date" },
      { receiverMobilePrint: "123" },
      { freightCharges: -1 },
      { paymentMode: "CASH" },
      { unknownPrintField: "not allowed" },
    ])
      expect(shipmentSchema.safeParse({ ...base, lrDetails }).success).toBe(false);
  });
});
