import { TRANSITIONS, SHIPMENT_STATUS } from "../src/constants/workflow.js";
describe("shipment workflow transition matrix", () => {
  test.each([
    ["BOOKED", "IN_TRANSIT"],
    ["IN_TRANSIT", "RECEIVED"],
    ["RECEIVED", "LR_IMAGE_UPLOADED"],
    ["LR_IMAGE_UPLOADED", "LR_IMAGE_VERIFIED"],
    ["LR_IMAGE_VERIFIED", "COMPLETED"],
    ["COMPLETED", "CLOSED"],
  ])("allows %s -> %s", (from, to) => expect(TRANSITIONS[from]).toContain(to));
  test.each([
    ["BOOKED", "CLOSED"],
    ["BOOKED", "COMPLETED"],
    ["RECEIVED", "CLOSED"],
    ["CLOSED", "IN_TRANSIT"],
  ])("blocks %s -> %s", (from, to) => expect(TRANSITIONS[from]).not.toContain(to));
  test("has one immutable terminal state", () => expect(TRANSITIONS[SHIPMENT_STATUS.CLOSED]).toEqual([]));
});
