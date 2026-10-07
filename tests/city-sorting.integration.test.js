import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Branch, Shipment, Segregation, MovementLeg, PackageUnit } from "../src/models/index.js";
import { createSorting, createLoadingTally, listSortings } from "../src/services/middle-mile.service.js";

const integration = process.env.RUN_MONGO_INTEGRATION === "true" ? describe : describe.skip;
integration("city sorting with historical LRs", () => {
  let replica;
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replica.getUri("city_sorting_regression"));
    await Promise.all([Branch.init(), Shipment.init(), Segregation.init(), MovementLeg.init()]);
  }, 60000);
  afterAll(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); }, 60000);
  test("sorts two historical LRs without revalidating or changing their goods data", async () => {
    const actor = new mongoose.Types.ObjectId();
    const office = await Branch.create({ branchCode: "NGP", name: "Nagpur", city: "Nagpur" });
    const docs = ["6ac4e6e63e4df950ebb8853c", "6ac4e6cc3e4df950ebb8844f"].map((_id, index) => ({
      _id: new mongoose.Types.ObjectId(_id), lrNumber: `LR-LEGACY-${index}`, customerId: new mongoose.Types.ObjectId(),
      originBranchId: office._id, destinationBranchId: office._id,
      senderName: "Sender", receiverName: "Receiver", currentStatus: "BOOKED", packageCount: 1, weightKg: 10,
      createdBy: actor, lrDetails: { from: "Nagpur", to: "Yavatmal", consigneePincode: "445001",
        goods: [{ description: "Historical goods", quantity: 1, actualWeight: 10, dimensionUnit: "M" }] },
    }));
    // Existing database data may predate the current goods dimension enum.
    await Shipment.collection.insertMany(docs);
    const oldLr = await Shipment.findById(docs[0]._id);
    oldLr.movementState = "SORTED";
    await expect(oldLr.save()).rejects.toMatchObject({ name: "ValidationError" });
    const request = { user: { _id: actor, role: "ADMIN", branchId: office._id }, get: () => "regression-test" };
    const result = await createSorting({ destination: "Yavatmal", shipmentIds: docs.map((lr) => String(lr._id)) }, request);
    expect(result.destination).toBe("Yavatmal");
    expect(result.shipmentIds).toHaveLength(2);
    expect(result.routeId).toBeUndefined();
    const updated = await Shipment.find({ _id: { $in: docs.map((lr) => lr._id) } }).lean();
    expect(updated.every((lr) => lr.movementState === "SORTED")).toBe(true);
    expect(updated.every((lr) => lr.lrDetails.goods[0].dimensionUnit === "M")).toBe(true);
    expect(await MovementLeg.countDocuments({ segregationId: result._id })).toBe(2);
    await PackageUnit.create(docs.map((lr) => ({ barcode: `${lr.lrNumber}-01OF1`, shipmentId: lr._id, lrNumber: lr.lrNumber, sequence: 1, totalPackages: 1, createdBy: actor })));
    const first = await createLoadingTally({ segregationId: String(result._id), shipmentIds: [String(docs[0]._id)], loadingBay: "Bay 1", vehicleType: "Truck", vehicleCapacityKg: 10 }, request);
    expect(first.totalLrs).toBe(1);
    expect(first.totalWeightKg).toBe(10);
    expect(first.shipmentIds.map(String)).toEqual([String(docs[0]._id)]);
    const remaining = await Segregation.findOne({ _id: { $ne: result._id }, destination: "Yavatmal" });
    expect(remaining.shipmentIds.map(String)).toEqual([String(docs[1]._id)]);
    expect((await Shipment.findById(docs[1]._id)).movementState).toBe("SORTED");
    expect(await MovementLeg.countDocuments({ segregationId: remaining._id, shipmentId: docs[1]._id })).toBe(1);
    const available = await listSortings({}, request.user);
    expect(available.items.map((row) => String(row._id))).toContain(String(remaining._id));
    const second = await createLoadingTally({ segregationId: String(remaining._id), shipmentIds: [String(docs[1]._id)], loadingBay: "Bay 2", vehicleType: "Truck", vehicleCapacityKg: 10 }, request);
    expect(second.totalLrs).toBe(1);
    expect(second.shipmentIds.map(String)).toEqual([String(docs[1]._id)]);

    await expect(createSorting({ destination: "Yavatmal", shipmentIds: docs.map((lr) => String(lr._id)) }, request)).rejects.toMatchObject({ errorCode: "INVALID_SHIPMENT_SELECTION" });
  }, 60000);
});
