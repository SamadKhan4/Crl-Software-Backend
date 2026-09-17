import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const shipmentIds = [{ ...objectId, ref: "Shipment" }];

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    branchId: { ...objectId, ref: "Branch", required: true, index: true },
    customerId: { ...objectId, ref: "Customer", required: true, index: true },
    shipmentIds,
    periodFrom: Date,
    periodTo: Date,
    subtotal: { type: Number, required: true, min: 0 },
    gstRate: { type: Number, min: 0, max: 100, default: 0 },
    gstAmount: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    balanceAmount: { type: Number, required: true, min: 0 },
    issueDate: { type: Date, default: Date.now },
    dueDate: Date,
    status: {
      type: String,
      enum: ["DRAFT", "ISSUED", "PART_PAID", "PAID", "CANCELLED"],
      default: "DRAFT",
      index: true,
    },
    notes: { type: String, trim: true },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);

const allocationSchema = new Schema(
  {
    invoiceId: { ...objectId, ref: "Invoice", required: true },
    amount: { type: Number, required: true, min: 0.01 },
  },
  { _id: false },
);

const moneyReceiptSchema = new Schema(
  {
    receiptNumber: { type: String, required: true, unique: true, index: true },
    branchId: { ...objectId, ref: "Branch", required: true, index: true },
    customerId: { ...objectId, ref: "Customer", required: true, index: true },
    allocations: { type: [allocationSchema], default: [] },
    shipmentIds,
    receivedFrom: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentMode: { type: String, enum: ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"], required: true },
    transactionReference: { type: String, trim: true },
    receiptDate: { type: Date, required: true },
    remarks: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "CANCELLED"], default: "ACTIVE", index: true },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);

const quotationSchema = new Schema(
  {
    quotationNumber: { type: String, required: true, unique: true, index: true },
    branchId: { ...objectId, ref: "Branch", index: true },
    customerId: { ...objectId, ref: "Customer" },
    leadName: { type: String, required: true, trim: true },
    companyName: { type: String, trim: true },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    origin: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    goodsDescription: { type: String, required: true, trim: true },
    packageCount: { type: Number, required: true, min: 1 },
    weightKg: { type: Number, required: true, min: 0.01 },
    estimatedFreight: { type: Number, min: 0, default: 0 },
    gstRate: { type: Number, min: 0, max: 100, default: 0 },
    totalAmount: { type: Number, min: 0, default: 0 },
    validUntil: Date,
    status: {
      type: String,
      enum: ["REQUESTED", "QUOTED", "ACCEPTED", "REJECTED", "EXPIRED"],
      default: "REQUESTED",
      index: true,
    },
    source: { type: String, enum: ["PUBLIC", "INTERNAL"], required: true },
    notes: { type: String, trim: true },
    createdBy: { ...objectId, ref: "User" },
  },
  base,
);

const stationeryTransactionSchema = new Schema(
  {
    transactionNumber: { type: String, required: true, unique: true, index: true },
    branchId: { ...objectId, ref: "Branch", required: true, index: true },
    itemType: { type: String, enum: ["LR_BOOK", "POD_BOOK", "MONEY_RECEIPT_BOOK", "LABEL", "OTHER"], required: true },
    transactionType: { type: String, enum: ["RECEIVE", "ISSUE"], required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    serialFrom: { type: String, trim: true },
    serialTo: { type: String, trim: true },
    issuedToType: { type: String, enum: ["VENDOR", "FE", "BRANCH"] },
    vendorId: { ...objectId, ref: "Vendor" },
    userId: { ...objectId, ref: "User" },
    issuedToName: { type: String, trim: true },
    transactionDate: { type: Date, required: true },
    remarks: { type: String, trim: true },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);

for (const schema of [invoiceSchema, moneyReceiptSchema, quotationSchema, stationeryTransactionSchema]) {
  schema.index({ createdAt: -1, _id: -1 });
}
invoiceSchema.index({ customerId: 1, status: 1, dueDate: 1 });
moneyReceiptSchema.index({ customerId: 1, receiptDate: -1 });
stationeryTransactionSchema.index({ branchId: 1, itemType: 1, transactionDate: -1 });

export const Invoice = model("Invoice", invoiceSchema);
export const MoneyReceipt = model("MoneyReceipt", moneyReceiptSchema);
export const Quotation = model("Quotation", quotationSchema);
export const StationeryTransaction = model("StationeryTransaction", stationeryTransactionSchema);
