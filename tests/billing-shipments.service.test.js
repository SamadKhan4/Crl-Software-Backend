import mongoose from "mongoose";
import { jest } from "@jest/globals";
import { AuditLog, Counter, Customer, Invoice, Shipment } from "../src/models/index.js";
import { billingShipments, createInvoice } from "../src/services/tms.service.js";

afterEach(() => jest.restoreAllMocks());

test("retail displays all 9966 LRs without credit billing eligibility filters", async () => {
  const distinct = jest.fn().mockResolvedValue(["retail-account"]);
  const customers = jest.spyOn(Customer, "find").mockReturnValue({ distinct });
  const billed = jest.spyOn(Invoice, "distinct");
  const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: "lr", currentStatus: "BOOKED" }]) };
  const find = jest.spyOn(Shipment, "find").mockReturnValue(chain);
  jest.spyOn(Shipment, "countDocuments").mockResolvedValue(1);
  const result = await billingShipments({ billingType: "RETAIL" }, { role: "MANAGER" });
  expect(customers).toHaveBeenCalledWith({ customerCode: "9966" });
  expect(find).toHaveBeenCalledWith({ $or: [{ customerId: { $in: ["retail-account"] } }, { "lrDetails.consignorCode": "9966" }] });
  expect(billed).not.toHaveBeenCalled();
  expect(result.items[0].currentStatus).toBe("BOOKED");
});


test.each(["BOOKED", "IN_TRANSIT", "RECEIVED", "LR_IMAGE_UPLOADED", "LR_IMAGE_VERIFIED", "COMPLETED", "CLOSED"])("retail LR in %s reaches duplicate billing validation", async (currentStatus) => {
  const session = { withTransaction: async (work) => work(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(Customer, "findById").mockReturnValue({ session: async () => ({ status: "ACTIVE", customerType: "TO_PAY_PAID" }) });
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [{ _id: "lr", customerId: "customer", originBranchId: "branch", currentStatus }] });
  const duplicate = jest.spyOn(Invoice, "exists").mockReturnValue({ session: async () => true });
  await expect(createInvoice({ billingType: "RETAIL", customerId: "customer", shipmentIds: ["lr"] }, { user: { role: "MANAGER" } })).rejects.toMatchObject({ errorCode: "SHIPMENT_ALREADY_BILLED" });
  expect(duplicate).toHaveBeenCalled();
});

test.each([["RETAIL", "CANCELLED"], ["CREDIT", "BOOKED"]])("%s rejects status %s before invoice creation", async (billingType, currentStatus) => {
  const session = { withTransaction: async (work) => work(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(Customer, "findById").mockReturnValue({ session: async () => ({ status: "ACTIVE", customerType: billingType === "RETAIL" ? "TO_PAY_PAID" : "CREDIT" }) });
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [{ _id: "lr", customerId: "customer", originBranchId: "branch", currentStatus }] });
  await expect(createInvoice({ billingType, customerId: "customer", shipmentIds: ["lr"] }, { user: { role: "MANAGER" } })).rejects.toMatchObject({ errorCode: "SHIPMENT_NOT_ELIGIBLE" });
});


test.each([0, 5, 18])("creates a printable zero-amount retail invoice with GST rate %s", async (gstRate) => {
  const session = { withTransaction: async (work) => work(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  jest.spyOn(Customer, "findById").mockReturnValue({ session: async () => ({ status: "ACTIVE", customerType: "TO_PAY_PAID", toObject: () => ({ name: "Retail" }) }) });
  jest.spyOn(Shipment, "find").mockReturnValue({ session: async () => [{ _id: "lr", lrNumber: "LR-ZERO", customerId: "customer", originBranchId: "branch", currentStatus: "BOOKED", senderName: "Retail Sender", lrDetails: { totalAmount: 0, gstAmount: 0 } }] });
  jest.spyOn(Invoice, "exists").mockReturnValue({ session: async () => false });
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 1 });
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  jest.spyOn(Invoice, "create").mockImplementation(async ([data]) => [{ _id: "invoice", ...data }]);
  const invoice = await createInvoice({ billingType: "RETAIL", customerId: "customer", shipmentIds: ["lr"], gstRate }, { user: { _id: "manager", role: "MANAGER" }, get: () => "test" });
  expect(invoice).toMatchObject({ subtotal: 0, gstAmount: 0, totalAmount: 0, balanceAmount: 0, billTo: { name: "Retail Sender" }, lineItems: [{ lrNumber: "LR-ZERO", taxableAmount: 0 }] });
  expect(invoice.invoiceNumber).toMatch(/^INV-/);
});
