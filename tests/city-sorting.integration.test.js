import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Branch, Shipment, Segregation, MovementLeg } from "../src/models/index.js";
import { createSorting } from "../src/services/middle-mile.service.js";

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
    await expect(createSorting({ destination: "Yavatmal", shipmentIds: docs.map((lr) => String(lr._id)) }, request)).rejects.toMatchObject({ errorCode: "INVALID_SHIPMENT_SELECTION" });
  }, 60000);
});
