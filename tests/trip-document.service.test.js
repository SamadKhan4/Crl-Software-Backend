import { jest } from "@jest/globals";
import { Trip } from "../src/models/index.js";
import { getTrip } from "../src/services/tms.service.js";

afterEach(() => jest.restoreAllMocks());
const trip = { _id: "trip", branchId: { _id: "origin" }, toHubId: { _id: "destination" }, manifestIds: [{ manifestNumber: "MNF001", shipmentIds: [{ lrNumber: "LR001", packageCount: 26 }] }] };
function lookup() {
  const chain = { populate: jest.fn(() => chain), then: (resolve) => Promise.resolve(trip).then(resolve) };
  jest.spyOn(Trip, "findById").mockReturnValue(chain);
  return chain;
}

test("destination branch staff can view trip manifests and their LRs for unloading", async () => {
  const chain = lookup();
  const result = await getTrip("trip", { role: "EMPLOYEE", branchId: "destination", operationStages: ["LM"] });
  expect(result.manifestIds[0].shipmentIds[0].packageCount).toBe(26);
  expect(chain.populate).toHaveBeenCalledWith({ path: "manifestIds", populate: { path: "shipmentIds" } });
});

test("unrelated branch staff cannot read the trip document", async () => {
  lookup();
  await expect(getTrip("trip", { role: "EMPLOYEE", branchId: "other", operationStages: ["LM"] })).rejects.toMatchObject({ statusCode: 403 });
});
