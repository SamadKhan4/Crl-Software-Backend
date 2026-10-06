import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const shipmentIds = [{ ...objectId, ref: "Shipment", required: true }];
const common = {
  branchId: { ...objectId, ref: "Branch", required: true, index: true },
  shipmentIds,
  createdBy: { ...objectId, ref: "User", required: true },
};

const sortingItemSchema = new Schema(
  {
    shipmentId: { ...objectId, ref: "Shipment", required: true },
    status: { type: String, enum: ["PENDING", "SORTED", "HOLD"], default: "SORTED" },
    sortZone: { type: String, trim: true, maxlength: 80 },
    bay: { type: String, trim: true, maxlength: 80 },
    rack: { type: String, trim: true, maxlength: 80 },
    remarks: { type: String, trim: true, maxlength: 500 },
    sortedAt: Date,
    sortedBy: { ...objectId, ref: "User" },
  },
  { _id: false, strict: true },
);

const segregationSchema = new Schema(
  {
    destinationPincode: { type: String, trim: true },
    origin: { type: String, trim: true },
    loadingTallyId: { ...objectId, ref: "LoadingTally", index: true },
    segregationNumber: { type: String, required: true, unique: true, index: true },
    ...common,
    vendorId: { ...objectId, ref: "Vendor", index: true },
    destination: { type: String, trim: true },
    vehicleNumber: { type: String, uppercase: true, trim: true },
    driverName: { type: String, trim: true },
    driverMobile: { type: String, trim: true },
    fromHubId: { ...objectId, ref: "Branch", index: true },
    nextHubId: { ...objectId, ref: "Branch", index: true },
    routeId: { ...objectId, ref: "BusinessMaster", index: true },
    items: { type: [sortingItemSchema], default: [] },
    status: { type: String, enum: ["PENDING", "READY", "HOLD", "MANIFESTED", "CANCELLED"], default: "READY", index: true },
    manifestId: { ...objectId, ref: "Manifest" },
    remarks: { type: String, trim: true },
  },
  base,
);

const manifestSchema = new Schema(
  {
    origin: { type: String, trim: true },
    manifestNumber: { type: String, required: true, unique: true, index: true },
    ...common,
    segregationId: { ...objectId, ref: "Segregation", index: true },
    loadingTallyId: { ...objectId, ref: "LoadingTally", index: true },
    vendorId: { ...objectId, ref: "Vendor", index: true },
    destination: { type: String, required: true, trim: true },
    vehicleNumber: { type: String, uppercase: true, trim: true },
    deliveryAgent: { type: String, trim: true },
    vendorReference: { type: String, trim: true },
    coLoaderStatus: {
      type: String,
      enum: ["BOOKED", "PICKED_UP", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION"],
      default: "BOOKED",
      index: true,
    },
    status: { type: String, enum: ["OPEN", "CLOSED", "CANCELLED"], default: "OPEN", index: true },
    workflowStatus: { type: String, enum: ["DRAFT", "READY", "LOCKED", "TRIP_ASSIGNED", "DISPATCHED"], default: "DRAFT", index: true },
    fromHubId: { ...objectId, ref: "Branch", index: true },
    toHubId: { ...objectId, ref: "Branch", index: true },
    routeId: { ...objectId, ref: "BusinessMaster", index: true },
    totalLrs: { type: Number, min: 0, default: 0 },
    totalPackages: { type: Number, min: 0, default: 0 },
    totalWeightKg: { type: Number, min: 0, default: 0 },
    lockedAt: Date,
    lockedBy: { ...objectId, ref: "User" },
    tripId: { ...objectId, ref: "Trip", index: true },
    remarks: { type: String, trim: true },
  },
  base,
);

const tripSchema = new Schema(
  {
    tripNumber: { type: String, required: true, unique: true, index: true },
    ...common,
    vendorId: { ...objectId, ref: "Vendor" },
    manifestIds: [{ ...objectId, ref: "Manifest" }],
    tripType: { type: String, enum: ["MIDDLE_MILE", "LEGACY"], default: "LEGACY", index: true },
    sealNumber: { type: String, trim: true, maxlength: 80 },
    vehicleSource: { type: String, enum: ["VV", "MV"] },
    vehicleMasterId: { ...objectId, ref: "BusinessMaster" },
    driverMasterId: { ...objectId, ref: "BusinessMaster" },
    fromHubId: { ...objectId, ref: "Branch", index: true },
    toHubId: { ...objectId, ref: "Branch", index: true },
    routeId: { ...objectId, ref: "BusinessMaster", index: true },
    vehicleNumber: { type: String, required: true, uppercase: true, trim: true, index: true },
    driverName: { type: String, required: true, trim: true },
    driverMobile: { type: String, trim: true },
    vehicleType: { type: String, trim: true },
    vehicleCapacityKg: { type: Number, min: 0 },
    origin: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    departureDate: { type: Date, required: true },
    expectedArrival: Date,
    freightAmount: { type: Number, min: 0, default: 0 },
    advanceAmount: { type: Number, min: 0, default: 0 },
    startKm: { type: Number, min: 0, default: 0 },
    endKm: { type: Number, min: 0 },
    dieselAmount: { type: Number, min: 0, default: 0 },
    tollAmount: { type: Number, min: 0, default: 0 },
    otherExpense: { type: Number, min: 0, default: 0 },
    revenueAmount: { type: Number, min: 0, default: 0 },
    totalLrs: { type: Number, min: 0, default: 0 },
    totalPackages: { type: Number, min: 0, default: 0 },
    totalWeightKg: { type: Number, min: 0, default: 0 },
    workflowStatus: { type: String, enum: ["DRAFT", "READY_FOR_DISPATCH", "DISPATCHED", "IN_TRANSIT", "ARRIVED", "CLOSED"], default: "DRAFT", index: true },
    dispatchedAt: Date,
    arrivedAt: Date,
    status: {
      type: String,
      enum: ["PLANNED", "DISPATCHED", "ARRIVED", "CLOSED", "CANCELLED"],
      default: "PLANNED",
      index: true,
    },
    remarks: { type: String, trim: true },
  },
  base,
);

const partBSchema = new Schema(
  {
    eWayBillNo: { type: String, required: true, trim: true },
    vehicleNumber: { type: String, required: true, uppercase: true, trim: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const drsSchema = new Schema(
  {
    drsNumber: { type: String, required: true, unique: true, index: true },
    ...common,
    vehicleNumber: { type: String, required: true, uppercase: true, trim: true },
    driverName: { type: String, required: true, trim: true },
    driverMobile: { type: String, trim: true },
    deliveryDate: { type: Date, required: true },
    route: { type: String, required: true, trim: true },
    deliveryAgentId: { ...objectId, ref: "User", index: true },
    workflowStatus: { type: String, enum: ["DRAFT", "READY_FOR_DISPATCH", "DISPATCHED", "CLOSURE_PENDING", "CLOSED", "CANCELLED"], default: "DRAFT", index: true },
    finalizedAt: Date,
    finalizedBy: { ...objectId, ref: "User" },
    dispatchedAt: Date,
    dispatchedBy: { ...objectId, ref: "User" },
    items: [{
      shipmentId: { ...objectId, ref: "Shipment", required: true },
      attemptStatus: { type: String, enum: ["PENDING", "DELIVERED", "UNDELIVERED", "REATTEMPT"], default: "PENDING" },
      failureReason: { type: String, trim: true, maxlength: 300 },
      nextAction: { type: String, trim: true, maxlength: 300 },
      reattemptDate: Date,
      attemptedAt: Date,
      attemptedBy: { ...objectId, ref: "User" },
      remarks: { type: String, trim: true, maxlength: 500 },
      podDocumentId: { ...objectId, ref: "ShipmentDocument" },
    }],
    partB: { type: [partBSchema], default: [] },
    podShipmentIds: [{ ...objectId, ref: "Shipment" }],
    deliveryProofs: [{
      shipmentId: { ...objectId, ref: "Shipment", required: true },
      receiverName: { type: String, required: true, trim: true, maxlength: 120 },
      receiverMobile: { type: String, trim: true, maxlength: 20 },
      otpReference: { type: String, trim: true, maxlength: 20 },
      signatureName: { type: String, trim: true, maxlength: 120 },
      remarks: { type: String, trim: true, maxlength: 500 },
      deliveredAt: { type: Date, default: Date.now },
      recordedBy: { ...objectId, ref: "User", required: true },
      documentId: { ...objectId, ref: "ShipmentDocument" },
    }],
    status: { type: String, enum: ["OPEN", "CLOSED", "CANCELLED"], default: "OPEN", index: true },
    closedAt: Date,
    closedBy: { ...objectId, ref: "User" },
    remarks: { type: String, trim: true },
  },
  base,
);

for (const schema of [segregationSchema, manifestSchema, tripSchema, drsSchema]) {
  schema.index({ branchId: 1, createdAt: -1, _id: -1 });
  schema.index({ shipmentIds: 1, status: 1 });
}

export const Manifest = model("Manifest", manifestSchema);
export const Segregation = model("Segregation", segregationSchema);
export const Trip = model("Trip", tripSchema);
export const DeliveryRunSheet = model("DeliveryRunSheet", drsSchema);
