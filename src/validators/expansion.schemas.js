import { z } from "zod";
import { MASTER_TYPES } from "../models/business-master.model.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");
const text = (max) => z.string().trim().max(max).optional();
const amount = z.coerce.number().finite().min(0).max(1_000_000_000);
const optionalNumber = z.preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.number().finite().optional());
const bool = z.coerce.boolean().optional();

const documentSchema = z.object({
  type: text(60), number: text(120), issuedAt: z.coerce.date().optional(), expiresAt: z.coerce.date().optional(),
  fileUrl: z.string().url().max(1000).optional(), verified: bool,
}).strict();

const masterBaseSchema = z.object({
  type: z.enum(MASTER_TYPES),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  branchId: objectId.optional(), vendorId: objectId.optional(), driverId: objectId.optional(),
  address: text(500), city: text(100), state: text(100), pincode: z.string().regex(/^\d{6}$/).optional(), zone: text(80),
  latitude: optionalNumber.pipe(z.number().min(-90).max(90).optional()),
  longitude: optionalNumber.pipe(z.number().min(-180).max(180).optional()),
  origin: text(150), destination: text(150), distanceKm: amount.optional(), transitDays: z.coerce.number().int().min(0).max(365).optional(),
  intermediateHubs: z.array(z.string().trim().min(2).max(120)).max(30).default([]),
  vehicleType: text(80), vehicleNumber: text(20), capacityKg: amount.optional(), capacityTon: amount.optional(),
  length: amount.optional(), width: amount.optional(), height: amount.optional(), cft: amount.optional(),
  hsn: text(20), category: text(100), standardWeight: amount.optional(), packageType: text(80),
  flags: z.object({ serviceable: bool, oda: bool, fragile: bool, hazardous: bool, perishable: bool, temperatureControlled: bool }).strict().optional(),
  contact: z.object({ person: text(120), mobile: text(20), email: z.string().email().optional() }).strict().optional(),
  registration: z.object({ gstin: text(15), pan: text(10), tan: text(10), cin: text(30), udyam: text(40), iec: text(40) }).strict().optional(),
  bank: z.object({ bankName: text(120), accountName: text(150), accountNumber: text(40), ifsc: text(11), branch: text(120), upi: text(120) }).strict().optional(),
  documentSeries: z.object({ lr: text(40), invoice: text(40), creditNote: text(40), debitNote: text(40), receipt: text(40), payment: text(40), manifest: text(40), trip: text(40), epod: text(40), vendorBill: text(40) }).strict().optional(),
  financial: z.object({ hireRate: amount.default(0), driverCost: amount.default(0), fuelCost: amount.default(0), maintenanceCost: amount.default(0), toll: amount.default(0), fmRate: amount.default(0), mmRate: amount.default(0), lmRate: amount.default(0) }).strict().optional(),
  documents: z.array(documentSchema).max(50).default([]), notes: text(2000),
}).strict();
export const masterSchema = masterBaseSchema.superRefine((value, ctx) => {
  if (value.type === "ROUTE" && (!value.origin || !value.destination)) ctx.addIssue({ code: "custom", path: ["origin"], message: "Route requires origin and destination" });
  if (value.type === "LOCATION" && !value.pincode) ctx.addIssue({ code: "custom", path: ["pincode"], message: "Location requires pincode" });
  if (value.type === "VEHICLE" && !value.vehicleNumber) ctx.addIssue({ code: "custom", path: ["vehicleNumber"], message: "Vehicle number is required" });
});

export const masterUpdateSchema = masterBaseSchema.partial().refine((value) => Object.keys(value).length, "Provide at least one field");
export const masterListSchema = z.object({
  type: z.enum(MASTER_TYPES).optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional(), search: text(120),
  page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

const slab = z.object({ from: amount, to: amount.optional(), rate: amount, minimumCharge: amount.default(0) }).strict();
const extraCharge = z.object({ name: z.string().trim().min(2).max(80), basis: z.enum(["FIXED", "PER_BOX", "PER_KG", "PER_KM", "PERCENTAGE", "PER_VEHICLE"]), value: amount }).strict();
const rateCardBaseSchema = z.object({
  code: z.string().trim().min(2).max(50), partyType: z.enum(["CLIENT", "VENDOR"]),
  customerId: objectId.optional(), vendorId: objectId.optional(),
  service: z.enum(["FM", "MM", "LM", "PTL", "FTL", "PICKUP", "DELIVERY", "HUB_TRANSFER"]),
  origin: text(150), destination: text(150), pincode: z.string().regex(/^\d{6}$/).optional(), zone: text(80), vehicleType: text(80),
  basis: z.enum(["PER_BOX", "PER_KG", "PER_CHARGED_KG", "PER_TON", "PER_CFT", "PER_CBM", "PER_KM", "PER_VEHICLE", "PER_TRIP", "PER_LR", "PER_SHIPMENT", "FIXED", "SLAB", "PERCENTAGE"]),
  rate: amount, minimumCharge: amount.default(0), minimumWeightKg: amount.default(0), slabs: z.array(slab).max(100).default([]), charges: z.array(extraCharge).max(50).default([]),
  inclusions: z.object({ toll: bool, loading: bool, unloading: bool, driverBata: bool, fuel: bool }).strict().optional(),
  gstRate: amount.max(100).default(0), tdsRate: amount.max(100).default(0), effectiveFrom: z.coerce.date(), effectiveTo: z.coerce.date().optional(), status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
}).strict();
export const rateCardSchema = rateCardBaseSchema.superRefine((value, ctx) => {
  if (value.partyType === "CLIENT" && !value.customerId) ctx.addIssue({ code: "custom", path: ["customerId"], message: "Select client" });
  if (value.partyType === "VENDOR" && !value.vendorId) ctx.addIssue({ code: "custom", path: ["vendorId"], message: "Select vendor" });
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "Effective-to must follow effective-from" });
  if (value.basis === "SLAB" && !value.slabs.length) ctx.addIssue({ code: "custom", path: ["slabs"], message: "Add at least one slab" });
});
export const rateCardUpdateSchema = rateCardBaseSchema.partial().refine((value) => Object.keys(value).length, "Provide at least one field");
export const rateListSchema = z.object({ partyType: z.enum(["CLIENT", "VENDOR"]).optional(), customerId: objectId.optional(), vendorId: objectId.optional(), service: text(20), status: z.enum(["ACTIVE", "INACTIVE"]).optional(), search: text(120), page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
export const rateQuoteSchema = z.object({ partyType: z.enum(["CLIENT", "VENDOR"]), customerId: objectId.optional(), vendorId: objectId.optional(), service: z.enum(["FM", "MM", "LM", "PTL", "FTL", "PICKUP", "DELIVERY", "HUB_TRANSFER"]), origin: text(150), destination: text(150), pincode: z.string().regex(/^\d{6}$/).optional(), zone: text(80), vehicleType: text(80), weightKg: amount.default(0), chargedWeightKg: amount.default(0), boxes: amount.default(0), distanceKm: amount.default(0), cft: amount.default(0), cbm: amount.default(0), vehicleCount: amount.default(1), declaredValue: amount.default(0), at: z.coerce.date().default(() => new Date()) }).strict();

export const packageListSchema = z.object({ shipmentId: objectId.optional(), lrNumber: text(50), status: text(40), search: text(120), page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
export const packageBarcodeParams = z.object({ barcode: z.string().trim().min(5).max(100) }).strict();
export const packageShipmentParams = z.object({ shipmentId: objectId }).strict();
export const packageScanSchema = z.object({ action: z.enum(["PICKUP", "HUB_INWARD", "SORTED", "LOADED", "UNLOADED", "OUT_FOR_DELIVERY", "DELIVERED", "DAMAGE", "SHORT", "EXCESS", "HOLD", "MISROUTE", "CANCELLED"]), location: z.string().trim().min(2).max(180), branchId: objectId.optional(), routeCode: text(50), vehicleNumber: text(20), custodianType: z.enum(["BRANCH", "EMPLOYEE", "VENDOR", "VEHICLE", "CUSTOMER"]).optional(), custodianId: text(100), remarks: text(500) }).strict();

export const profitabilitySchema = z.object({ dateFrom: z.coerce.date().optional(), dateTo: z.coerce.date().optional(), customerId: objectId.optional(), vendorId: objectId.optional(), branchId: objectId.optional() }).strict();
export const bookingSchema = z.object({ branchId: objectId.optional(), destinationBranchId: objectId, customerId: objectId, bookingDate: z.coerce.date(), consignor: z.string().trim().min(2).max(120), consignee: z.string().trim().min(2).max(120), consigneeMobile: text(20), origin: z.string().trim().min(2).max(150), destination: z.string().trim().min(2).max(150), service: z.enum(["PTL", "FTL", "FM", "MM", "LM"]), packageCount: z.coerce.number().int().min(1).max(10000), weightKg: z.coerce.number().finite().positive().max(100000), description: z.string().trim().min(2).max(500), invoiceNumber: text(120), eWayBillNumber: text(120), expectedDeliveryDate: z.coerce.date().optional() }).strict();
export const bookingLrSchema = z.object({ lrNumber: z.string().trim().toUpperCase().min(1).max(50).regex(/^[A-Z0-9][A-Z0-9/._-]*$/) }).strict();
