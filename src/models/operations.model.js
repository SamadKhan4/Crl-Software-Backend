import mongoose from "mongoose";
import { base, objectId } from "./shared.js";

const { Schema, model } = mongoose;
const shipmentIds = [{ ...objectId, ref: "Shipment", required: true }];
const common = {
  branchId: { ...objectId, ref: "Branch", required: true, index: true },
  shipmentIds,
  createdBy: { ...objectId, ref: "User", required: true },
};

const manifestSchema = new Schema(
  {
    manifestNumber: { type: String, required: true, unique: true, index: true },
    ...common,
    vendorId: { ...objectId, ref: "Vendor", required: true, index: true },
    destination: { type: String, required: true, trim: true },
    vendorReference: { type: String, trim: true },
    coLoaderStatus: {
      type: String,
      enum: ["BOOKED", "PICKED_UP", "IN_TRANSIT", "AT_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION"],
      default: "BOOKED",
      index: true,
    },
    status: { type: String, enum: ["OPEN", "CLOSED", "CANCELLED"], default: "OPEN", index: true },
    remarks: { type: String, trim: true },
  },
  base,
);

const tripSchema = new Schema(
  {
    tripNumber: { type: String, required: true, unique: true, index: true },
    ...common,
    vendorId: { ...objectId, ref: "Vendor" },
    vehicleNumber: { type: String, required: true, uppercase: true, trim: true, index: true },
    driverName: { type: String, required: true, trim: true },
    driverMobile: { type: String, trim: true },
    origin: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    departureDate: { type: Date, required: true },
    expectedArrival: Date,
    freightAmount: { type: Number, min: 0, default: 0 },
    advanceAmount: { type: Number, min: 0, default: 0 },
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
    partB: { type: [partBSchema], default: [] },
    podShipmentIds: [{ ...objectId, ref: "Shipment" }],
    status: { type: String, enum: ["OPEN", "CLOSED", "CANCELLED"], default: "OPEN", index: true },
    closedAt: Date,
    closedBy: { ...objectId, ref: "User" },
    remarks: { type: String, trim: true },
  },
  base,
);

for (const schema of [manifestSchema, tripSchema, drsSchema]) {
  schema.index({ branchId: 1, createdAt: -1, _id: -1 });
  schema.index({ shipmentIds: 1, status: 1 });
}

export const Manifest = model("Manifest", manifestSchema);
export const Trip = model("Trip", tripSchema);
export const DeliveryRunSheet = model("DeliveryRunSheet", drsSchema);
