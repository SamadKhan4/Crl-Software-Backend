import { z } from "zod";
import { ACTIVE, DOCUMENT_STATUS, SHIPMENT_STATUS } from "../constants/workflow.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid MongoDB id");
const mobile = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, "Invalid mobile number");
const pincode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Invalid pincode");
const optionalText = (max) => z.string().trim().max(max).optional();
const strictEmpty = z.object({}).strict();

export const ids = z.object({ id: objectId }).strict();
export const documentIds = z.object({ id: objectId, documentId: objectId }).strict();
export const listSchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    search: z.string().trim().max(100).optional(),
    sortBy: z
      .string()
      .regex(/^[a-zA-Z]+$/)
      .optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    status: z.enum(Object.values(ACTIVE)).optional(),
  })
  .strict();
export const shipmentListSchema = listSchema
  .omit({ status: true })
  .extend({
    status: z.enum(Object.values(SHIPMENT_STATUS)).optional(),
    customerId: objectId.optional(),
    originBranchId: objectId.optional(),
    destinationBranchId: objectId.optional(),
    lrNumber: z.string().trim().max(50).optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  })
  .strict();
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128) }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(4096).optional() }).strict();
export const passwordSchema = z
  .object({ currentPassword: z.string().min(8).max(128), newPassword: z.string().min(12).max(128) })
  .strict();
export const resetPasswordSchema = z.object({ newPassword: z.string().min(12).max(128) }).strict();
export const activeStatusSchema = z.object({ status: z.enum(Object.values(ACTIVE)) }).strict();
export const userSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().email(),
    mobile: mobile.optional(),
    branchId: objectId,
    password: z.string().min(12).max(128),
  })
  .strict();
export const userUpdateSchema = userSchema.omit({ password: true }).partial().strict();
export const branchSchema = z
  .object({
    branchCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,20}$/),
    name: z.string().trim().min(2).max(100),
    address: optionalText(250),
    city: z.string().trim().min(2).max(80),
    state: optionalText(80),
    pincode: pincode.optional(),
    phone: mobile.optional(),
    email: z.string().email().optional(),
  })
  .strict();
export const customerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    companyName: optionalText(150),
    mobile,
    alternateMobile: mobile.optional(),
    email: z.string().email().optional(),
    address: optionalText(250),
    city: optionalText(80),
    state: optionalText(80),
    pincode: pincode.optional(),
    gstNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/)
      .optional(),
  })
  .strict();
export const shipmentSchema = z
  .object({
    customerId: objectId,
    originBranchId: objectId,
    destinationBranchId: objectId,
    senderName: z.string().trim().min(2).max(120),
    receiverName: z.string().trim().min(2).max(120),
    receiverMobile: mobile.optional(),
    packageCount: z.coerce.number().int().min(1).max(10000),
    weightKg: z.coerce.number().positive().max(100000),
    description: optionalText(500),
    expectedDeliveryDate: z.coerce.date().optional(),
  })
  .strict();
export const shipmentUpdateSchema = shipmentSchema
  .omit({ customerId: true, originBranchId: true, destinationBranchId: true })
  .partial()
  .strict();
export const overrideSchema = z
  .object({ reason: z.string().trim().min(8).max(500), changes: shipmentUpdateSchema })
  .strict();
export const statusSchema = z
  .object({
    status: z.enum([SHIPMENT_STATUS.IN_TRANSIT, SHIPMENT_STATUS.CANCELLED]),
    location: z.string().trim().min(2).max(120),
    remarks: optionalText(500),
  })
  .strict();
export const receiveSchema = z
  .object({ location: z.string().trim().min(2).max(120), remarks: optionalText(500) })
  .strict();
export const verifySchema = z
  .object({
    status: z.enum([DOCUMENT_STATUS.VERIFIED, DOCUMENT_STATUS.REJECTED]),
    remarks: z.string().trim().min(2).max(500),
  })
  .strict();
export const publicTrackSchema = z.object({ lrNumber: z.string().trim().min(5).max(50) }).strict();
export const customerCodeParams = z.object({ customerCode: z.string().trim().toUpperCase().min(6).max(30) }).strict();
export const publicRequestSchema = z
  .object({
    customerCode: z.string().trim().toUpperCase().min(6).max(30),
    lrNumber: z.string().trim().toUpperCase().min(5).max(50),
  })
  .strict();
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f\d]{64}$/i, "Invalid upload token") }).strict();
export const reportSchema = z
  .object({
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    status: z.enum(Object.values(SHIPMENT_STATUS)).optional(),
    branch: objectId.optional(),
    customer: objectId.optional(),
  })
  .strict();
export const emptySchema = strictEmpty;
