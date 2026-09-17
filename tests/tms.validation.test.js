import {
  drsSchema,
  invoiceSchema,
  manifestSchema,
  moneyReceiptSchema,
  publicQuotationSchema,
  stationerySchema,
  tripSchema,
  vendorSchema,
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
});
