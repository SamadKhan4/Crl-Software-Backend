import { jest } from "@jest/globals";
import { Shipment, ShipmentEvent } from "../src/models/index.js";
import { publicTrack } from "../src/services/shipment.service.js";

afterEach(() => jest.restoreAllMocks());
const lookup = (shipment) => {
  const chain = { populate: () => chain, lean: async () => shipment };
  jest.spyOn(Shipment, "findOne").mockReturnValue(chain);
  const events = { sort: () => events, select: () => events, lean: async () => [] };
  jest.spyOn(ShipmentEvent, "find").mockReturnValue(events);
};
test("tracking exposes shipment specs and assigned trip vehicle and driver only", async () => {
  lookup({ _id: "lr", lrNumber: "LR001", packageCount: 4, weightKg: 50, expectedDeliveryDate: new Date(),
    pickupRequestId: { serviceType: "PTL" }, lrDetails: { actualWeight: 48, chargedWeight: 60, totalAmount: 999 },
    activeMovementLegId: { tripId: { vehicleNumber: "MH31AB1234", vehicleType: "Truck", driverName: "Driver", driverMobile: "9876543210", sealNumber: "SEAL1", freightAmount: 999 } } });
  const result = await publicTrack("lr001");
  expect(result).toMatchObject({ transportMode: "PTL", packageCount: 4, grossWeightKg: 48, chargeableWeightKg: 60, vehicleNumber: "MH31AB1234", vehicleType: "Truck", driverName: "Driver", sealNumber: "SEAL1" });
  expect(result).not.toHaveProperty("driverMobile");
  expect(result).not.toHaveProperty("expectedDeliveryDate");
  expect(result).not.toHaveProperty("freightAmount");
  expect(result).not.toHaveProperty("lrDetails");
});
test("delivery assignment takes precedence over the middle-mile trip", async () => {
  lookup({ _id: "lr", lrNumber: "LR001", weightKg: 50,
    activeDrsId: { workflowStatus: "DISPATCHED", vehicleNumber: "DELIVERY", driverName: "Delivery Driver", driverMobile: "9876543210" },
    activeMovementLegId: { tripId: { vehicleNumber: "OLD" } } });
  expect(await publicTrack("LR001")).toMatchObject({ grossWeightKg: 50, vehicleNumber: "DELIVERY", driverName: "Delivery Driver" });
});
test("tracking works without optional specs or an assigned vehicle", async () => {
  lookup({ _id: "lr", lrNumber: "LR001", weightKg: 10 });
  const result = await publicTrack("LR001");
  expect(result.grossWeightKg).toBe(10);
  expect(result.driverMobile).toBeUndefined();
  expect(result.transportMode).toBeUndefined();
});
