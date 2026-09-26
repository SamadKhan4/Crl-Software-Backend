import mongoose from "mongoose";
import { SHIPMENT_STATUS } from "../constants/workflow.js";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;

const goodsRowSchema = new Schema({
  packageNumber: { type: String, trim: true, maxlength: 80 },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  packageType: { type: String, trim: true, maxlength: 120 },
  quantity: { type: Number, required: true, min: 1, max: 10000 },
  actualWeight: { type: Number, required: true, min: 0.01, max: 100000 },
  length: { type: Number, min: 0, max: 100000 },
  breadth: { type: Number, min: 0, max: 100000 },
  height: { type: Number, min: 0, max: 100000 },
  dimensionUnit: { type: String, required: true, enum: ['CM', 'IN', 'FT'] },
  volume: { type: Number, min: 0 },
  volumetricWeight: { type: Number, min: 0 },
  chargedWeight: { type: Number, min: 0 },
}, { _id: false, strict: true });

const lrDetailsSchema = new Schema(
  {
    goods: { type: [goodsRowSchema], default: undefined },
    volumetricWeight: { type: Number, min: 0 },
    consignorCode: { type: String, trim: true, maxlength: 80 },
    consignorAddress: { type: String, trim: true, maxlength: 500 },
    consignorAddress2: { type: String, trim: true, maxlength: 500 },
    consignorPincode: { type: String, trim: true, match: /^\d{6}$/ },
    consignorGstin: { type: String, trim: true, uppercase: true, match: /^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/ },
    consigneeAddress: { type: String, trim: true, maxlength: 500 },
    consigneeAddress2: { type: String, trim: true, maxlength: 500 },
    consigneeAddress3: { type: String, trim: true, maxlength: 500 },
    consigneePincode: { type: String, trim: true, match: /^\d{6}$/ },
    consigneeGstin: { type: String, trim: true, uppercase: true, match: /^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/ },
    bookingDate: Date,
    bookingBranch: { type: String, trim: true, maxlength: 120 },
    from: { type: String, trim: true, maxlength: 120 },
    to: { type: String, trim: true, maxlength: 120 },
    deliveryAddress: { type: String, trim: true, maxlength: 500 },
    contactNo: { type: String, trim: true, match: /^\+?[1-9]\d{7,14}$/ },
    invoiceNo: { type: String, trim: true, maxlength: 120 },
    invoiceDate: Date,
    eWayBillNo: { type: String, trim: true, maxlength: 120 },
    eWayBillDate: Date,
    poStnNo: { type: String, trim: true, maxlength: 120 },
    customerReference: { type: String, trim: true, maxlength: 250 },
    packageNumber: { type: String, trim: true, maxlength: 80 },
    packageType: { type: String, trim: true, maxlength: 120 },
    actualWeight: { type: Number, min: 0.000001 },
    chargedWeight: { type: Number, min: 0.000001 },
    dimensions: { type: String, trim: true, maxlength: 200 },
    volume: { type: Number, min: 0 },
    declaredValue: { type: Number, min: 0 },
    shipperSignature: { type: String, trim: true, maxlength: 50000 },
    remarks: { type: String, trim: true, maxlength: 1000 },
    receiverNamePrint: { type: String, trim: true, maxlength: 120 },
    receiverMobilePrint: { type: String, trim: true, match: /^\+?[1-9]\d{7,14}$/ },
    receiverDateTime: Date,
    receiverSignature: { type: String, trim: true, maxlength: 50000 },
    paymentMode: { type: String, enum: ["PAID", "TO_PAY", "CREDIT"] },
    riskType: { type: String, enum: ["CARRIER_RISK", "OWNER_RISK"] },
    insuranceType: { type: String, enum: ["INSURED", "NOT_INSURED"] },
    freightBasis: { type: String, enum: ["PER_KG", "PER_BOX", "FIXED"] },
    freightRate: { type: Number, min: 0 },
    fuelRatePercent: { type: Number, min: 0, max: 100 },
    rovRatePercent: { type: Number, min: 0, max: 100 },
    freightCharges: { type: Number, min: 0 },
    fuelCharges: { type: Number, min: 0 },
    handlingCharges: { type: Number, min: 0 },
    fodCharges: { type: Number, min: 0 },
    codCharges: { type: Number, min: 0 },
    fodCodCharges: { type: Number, min: 0 },
    rovCharges: { type: Number, min: 0 },
    docketCharges: { type: Number, min: 0 },
    gstRate: { type: Number, min: 0, max: 100 },
    gstAmount: { type: Number, min: 0 },
    totalAmount: { type: Number, min: 0 },
  },
  { _id: false, strict: true },
);

const shipmentSchema = new Schema(
  {
    lrNumber: { type: String, required: true, unique: true, trim: true, maxlength: 50, uppercase: true, index: true },
    idempotencyKey: { type: String, sparse: true, unique: true, index: true },
    pickupRequestId: { ...objectId, ref: "PickupRequest", sparse: true, unique: true, index: true },
    customerId: { ...objectId, ref: "Customer", required: true, index: true },
    originBranchId: { ...objectId, ref: "Branch", required: true, index: true },
    destinationBranchId: { ...objectId, ref: "Branch", required: true, index: true },
    currentStatus: {
      type: String,
      enum: Object.values(SHIPMENT_STATUS),
      default: SHIPMENT_STATUS.BOOKED,
      index: true,
    },
    currentLocation: { type: String, trim: true },
    senderName: { type: String, required: true, trim: true },
    receiverName: { type: String, required: true, trim: true },
    receiverMobile: { type: String, trim: true },
    packageCount: { type: Number, required: true, min: 1 },
    weightKg: { type: Number, required: true, min: 0.01 },
    description: { type: String, trim: true },
    expectedDeliveryDate: Date,
    lrDetails: lrDetailsSchema,
    receivedAt: Date,
    receivedBy: { ...objectId, ref: "User" },
    receivedLocation: String,
    receivingBranchId: { ...objectId, ref: "Branch" },
    createdBy: { ...objectId, ref: "User", required: true },
  },
  base,
);
shipmentSchema.index({ createdAt: -1, _id: -1 });
shipmentSchema.index({ originBranchId: 1, createdAt: -1, _id: -1 });
shipmentSchema.index({ destinationBranchId: 1, createdAt: -1, _id: -1 });
shipmentSchema.index({ currentStatus: 1, createdAt: -1, _id: -1 });
shipmentSchema.index({ customerId: 1, createdAt: -1, _id: -1 });

export const Shipment = model("Shipment", shipmentSchema);
