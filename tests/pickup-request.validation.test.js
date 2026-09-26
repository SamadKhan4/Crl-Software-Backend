import {
  agentLrListSchema,
  pickupAgentAssignmentSchema,
  pickupRequestListSchema,
  pickupRequestSchema,
  pickupRequestStatusSchema,
  pickupRunSheetListSchema,
  pickupRunSheetApprovalSchema,
  pickupRunSheetPurSchema,
  pickupRunSheetSchema,
} from "../src/validators/expansion.schemas.js";

const valid = {
  shipper: {
    companyName: "Credit Client Private Limited",
    city: "Nagpur",
    address: "MIDC Hingna Road",
    pincode: "440016",
    gstin: "27ABCDE1234F1Z5",
    contactName: "Dispatch Manager",
    contactMobile: "+919876543210",
  },
  recipient: {
    companyName: "Receiver Private Limited",
    city: "Pune",
    address: "Chakan Industrial Area",
    pincode: "410501",
    gstin: "27ABCDE1234F1Z5",
  },
  serviceType: "FTL",
  totalBoxes: 10,
  totalWeightKg: 1250.5,
};

describe("Pickup request validation", () => {
  test("accepts FTL and PTL pickup request payloads", () => {
    expect(pickupRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      pickupRequestSchema.safeParse({
        ...valid,
        serviceType: "PTL",
        movementType: "DOOR_TO_DOOR",
      }).success,
    ).toBe(true);
  });

  test("requires PTL movement and validates contact, GSTIN and package totals", () => {
    for (const payload of [
      { ...valid, serviceType: "PTL" },
      { ...valid, shipper: { ...valid.shipper, contactMobile: "123" } },
      { ...valid, recipient: { ...valid.recipient, gstin: "invalid" } },
      { ...valid, totalBoxes: 0 },
      { ...valid, totalWeightKg: 0 },
    ])
      expect(pickupRequestSchema.safeParse(payload).success).toBe(false);
  });

  test("strictly validates list filters and status changes", () => {
    expect(pickupRequestListSchema.safeParse({ status: "PENDING", page: "1" }).success).toBe(true);
    expect(pickupRequestListSchema.safeParse({ status: "UNKNOWN" }).success).toBe(false);
    expect(pickupRequestStatusSchema.safeParse({ status: "CANCELLED" }).success).toBe(true);
    expect(pickupRequestStatusSchema.safeParse({ status: "DISPATCHED" }).success).toBe(false);
  });

  test("validates vendor, vehicle and driver alignment", () => {
    const assignment = {
      sourceType: "VENDOR",
      vendorId: "66d8f14124b86f067a916601",
      agentName: "Pickup Agent",
      vehicleNumber: "MH31AB1234",
      vehicleType: "Tata Ace",
      driverName: "Driver Name",
      driverMobile: "+919876543210",
      remarks: "Morning pickup",
    };
    expect(pickupAgentAssignmentSchema.safeParse(assignment).success).toBe(true);
    expect(
      pickupAgentAssignmentSchema.safeParse({
        ...assignment,
        sourceType: "MARKET",
        vendorId: undefined,
      }).success,
    ).toBe(true);
    expect(
      pickupAgentAssignmentSchema.safeParse({ ...assignment, sourceType: "MARKET" }).success,
    ).toBe(false);
    expect(
      pickupAgentAssignmentSchema.safeParse({ ...assignment, driverMobile: "123" }).success,
    ).toBe(false);
    expect(pickupAgentAssignmentSchema.safeParse({ ...assignment, vendorId: "bad" }).success).toBe(
      false,
    );
  });

  test("validates PRS creation and register filters", () => {
    expect(
      pickupRunSheetSchema.safeParse({
        vendorCategory: "TRANSPORTER",
        rateSource: "MASTER",
        vendorId: "66d8f14124b86f067a916601",
        fieldExecutiveId: "66d8f14124b86f067a916602",
        vehicleNumber: "MH31AB1234",
        vehicleType: "Tata Ace",
        pickupDate: "2026-09-26",
        route: "Nagpur → Hingna",
        remarks: "First Mile dispatch",
      }).success,
    ).toBe(true);
    expect(
      pickupRunSheetSchema.safeParse({ vendorCategory: "TRANSPORTER", rateSource: "MARKET", pickupDate: "invalid", route: "" }).success,
    ).toBe(false);
    expect(pickupRunSheetPurSchema.safeParse({ pickupRequestId: "66d8f14124b86f067a916601", paymentTerm: "CREDIT", amount: 2500 }).success).toBe(true);
    expect(pickupRunSheetApprovalSchema.safeParse({ decision: "APPROVED", remarks: "Market rate approved" }).success).toBe(true);
    expect(pickupRunSheetListSchema.safeParse({ status: "DISPATCHED", sortBy: "pickupDate" }).success).toBe(true);
    expect(pickupRunSheetListSchema.safeParse({ status: "OPEN" }).success).toBe(false);
  });

  test("validates Agent LR auto-reflection filters", () => {
    expect(agentLrListSchema.safeParse({ status: "DISPATCHED", sourceType: "VENDOR", search: "LR-100" }).success).toBe(true);
    expect(agentLrListSchema.safeParse({ sourceType: "UNKNOWN" }).success).toBe(false);
  });
});
