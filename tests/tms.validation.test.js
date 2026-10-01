import {
  drsSchema,
  invoiceSchema,
  manifestSchema,
  middleMileInwardSchema,
  middleMileManifestSchema,
  middleMileSortingSchema,
  middleMileTripSchema,
  loadingTallySchema,
  moneyReceiptSchema,
  publicQuotationSchema,
  stationerySchema,
  tripSchema,
  vendorSchema,
  unloadingTallySchema,
  unloadingTallyCompleteSchema,
  lastMileQcSchema,
  lastMileDrsSchema,
  deliveryAttemptSchema,
} from "../src/validators/schemas.js";

const id = "66d8f14124b86f067a916601";
const otherId = "66d8f14124b86f067a916602";

describe("TMS request validation", () => {
  test("accepts vendor commercials and vehicle mapping", () => {
    expect(
      vendorSchema.safeParse({
        vendorType: "CO_LOADER",
        name: "Reliable Road Carrier",
        mobile: "+919876543210",
        commercial: {
          rateBasis: "PER_KG",
          rate: 4.5,
          fuelSurchargePercent: 8,
          handlingCharge: 50,
          detentionPerDay: 500,
          creditDays: 30,
          gstRate: 5,
        },
        vehicles: [{ vehicleNumber: "MH31AB1234", capacityKg: 9000, status: "ACTIVE" }],
      }).success,
    ).toBe(true);
  });

  test("rejects duplicate LR allocation and invalid trip dates", () => {
    expect(
      manifestSchema.safeParse({ vendorId: id, destination: "Mumbai", shipmentIds: [otherId, otherId] }).success,
    ).toBe(false);
    expect(
      tripSchema.safeParse({
        vehicleNumber: "MH31AB1234",
        driverName: "Driver Name",
        origin: "Nagpur",
        destination: "Mumbai",
        departureDate: "2026-09-18",
        expectedArrival: "2026-09-17",
        shipmentIds: [otherId],
      }).success,
    ).toBe(false);
  });

  test("validates DRS, invoice and receipt controls", () => {
    expect(
      drsSchema.safeParse({
        vehicleNumber: "MH31AB1234",
        driverName: "Driver Name",
        deliveryDate: "2026-09-18",
        route: "Nagpur local",
        shipmentIds: [otherId],
        partB: [{ eWayBillNo: "EWB123", vehicleNumber: "MH31AB1234" }],
      }).success,
    ).toBe(true);
    expect(
      invoiceSchema.safeParse({ customerId: id, shipmentIds: [otherId], issueDate: "2026-09-18", gstRate: 5 }).success,
    ).toBe(true);
    expect(
      moneyReceiptSchema.safeParse({
        customerId: id,
        receivedFrom: "Accounts",
        amount: 1000,
        paymentMode: "UPI",
        receiptDate: "2026-09-18",
      }).success,
    ).toBe(false);
  });

  test("keeps public pricing server-controlled and stationery issue assigned", () => {
    const quote = {
      leadName: "Customer Name",
      mobile: "+919876543210",
      origin: "Nagpur",
      destination: "Pune",
      goodsDescription: "Machine parts",
      packageCount: 2,
      weightKg: 120,
    };
    expect(publicQuotationSchema.safeParse(quote).success).toBe(true);
    expect(publicQuotationSchema.safeParse({ ...quote, estimatedFreight: 10 }).success).toBe(false);
    expect(
      stationerySchema.safeParse({
        itemType: "LR_BOOK",
        transactionType: "ISSUE",
        quantity: 1,
        transactionDate: "2026-09-18",
      }).success,
    ).toBe(false);
  });

  test("validates the connected Middle Mile request contracts", () => {
    expect(middleMileInwardSchema.safeParse({ lrNumber: "LR-1001", nextHubId: id }).success).toBe(true);
    expect(middleMileSortingSchema.safeParse({ shipmentIds: [id], nextHubId: otherId, sortZone: "A-01" }).success).toBe(true);
    expect(loadingTallySchema.safeParse({ segregationId: id, loadingBay: "BAY-1" }).success).toBe(true);
    expect(middleMileManifestSchema.safeParse({ loadingTallyId: id }).success).toBe(true);
    expect(middleMileTripSchema.safeParse({
      manifestIds: [id], vehicleSource: "MV", vehicleNumber: "MH31AB1234", driverName: "Driver Name",
      departureDate: "2026-09-28T10:00:00.000Z",
    }).success).toBe(true);
    expect(middleMileTripSchema.safeParse({
      manifestIds: [id, id], vehicleSource: "VV", vehicleNumber: "MH31AB1234", driverName: "Driver Name",
      departureDate: "2026-09-28T10:00:00.000Z",
    }).success).toBe(false);
  });

  test("validates Last Mile unloading, QC, DRS and delivery attempts", () => {
    expect(unloadingTallySchema.safeParse({ tripId: id, unloadingBay: "BAY-LM-1" }).success).toBe(true);
    expect(unloadingTallyCompleteSchema.safeParse({ exceptions: [{ shipmentId: otherId, damagedPackages: 1, depsCode: "DMG" }] }).success).toBe(true);
    expect(lastMileQcSchema.safeParse({ qcStatus: "PASSED", storageLocation: "RACK-A1" }).success).toBe(true);
    expect(lastMileDrsSchema.safeParse({ vehicleNumber: "MH31AB1234", driverName: "Driver Name", deliveryDate: "2026-09-28", route: "Local", shipmentIds: [otherId], partB: [] }).success).toBe(true);
    expect(deliveryAttemptSchema.safeParse({ outcome: "REATTEMPT", failureReason: "Customer unavailable", reattemptDate: "2026-09-29" }).success).toBe(true);
    expect(deliveryAttemptSchema.safeParse({ outcome: "UNKNOWN" }).success).toBe(false);
  });
});
