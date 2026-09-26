import { z } from "zod";
import { ACTIVE, DOCUMENT_STATUS, SHIPMENT_STATUS } from "../constants/workflow.js";
import { SERVICE_LOCATION_NAMES } from "../constants/service-locations.js";

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
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/, "Invalid GSTIN");
const positiveNumber = z.coerce.number().positive().max(1000000000);
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
    vendorId: objectId.optional(),
    permissions: z.array(z.object({ module: z.string().trim().min(2).max(60).transform((value) => value.toUpperCase()), actions: z.array(z.enum(["VIEW", "ADD", "EDIT", "DELETE", "APPROVE", "PRINT", "EXPORT"])).max(7) }).strict()).max(100).optional(),
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
const creditRateSchema = z
  .object({
    location: z.enum(SERVICE_LOCATION_NAMES),
    transitDays: z.coerce.number().int().min(1).max(30),
    ratePerKg: z.coerce.number().finite().positive().max(1000000),
  })
  .strict();
const customerCharge = z.coerce.number().finite().min(0).max(100000000).default(0);
const customerPercent = z.coerce.number().finite().min(0).max(100).default(0);
const creditChargesSchema = z
  .object({
    fuelRatePercent: customerPercent,
    handlingCharges: customerCharge,
    fodCharges: customerCharge,
    codCharges: customerCharge,
    rovRatePercent: customerPercent,
    docketCharges: customerCharge,
    gstRate: customerPercent,
  })
  .strict()
  .default({});
const customerFields = z
  .object({
    customerType: z.enum(["CREDIT", "TO_PAY_PAID"]),
    name: z.string().trim().min(2).max(120),
    companyName: optionalText(150),
    mobile,
    alternateMobile: mobile.optional(),
    email: z.string().email().optional(),
    address: optionalText(250),
    city: optionalText(80),
    state: optionalText(80),
    pincode: pincode.optional(),
    gstNumber: gstin.optional(),
    legalName: optionalText(150),
    tradeName: optionalText(150),
    industry: optionalText(100),
    panNumber: optionalText(10),
    gstType: optionalText(40),
    billingState: optionalText(100),
    billingAddress: optionalText(500),
    pickupLocations: z.array(z.object({ code: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(150), address: optionalText(500), city: optionalText(100), state: optionalText(100), pincode: pincode.optional(), contactPerson: optionalText(120), mobile: mobile.optional() }).strict()).max(100).default([]),
    deliveryLocations: z.array(z.object({ code: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(150), address: optionalText(500), city: optionalText(100), state: optionalText(100), pincode: pincode.optional(), contactPerson: optionalText(120), mobile: mobile.optional() }).strict()).max(100).default([]),
    services: z.array(z.enum(["HUB_TO_HUB", "DOOR_TO_DOOR", "DOOR_TO_HUB", "HUB_TO_DOOR", "PTL", "FTL", "FM", "MM", "LM", "PICKUP", "DELIVERY", "REVERSE"])).max(12).default([]),
    billing: z.object({ cycle: optionalText(60), paymentTerms: optionalText(120), creditLimit: customerCharge, creditDays: z.coerce.number().int().min(0).max(365).default(0), invoiceMode: z.enum(["SINGLE_LR", "CONSOLIDATED", "BOTH"]).optional(), gstRate: customerPercent, tdsRate: customerPercent, billingEmail: z.string().email().optional() }).strict().optional(),
    contacts: z.array(z.object({ department: z.enum(["ACCOUNTS", "OPERATIONS", "LOGISTICS", "MANAGEMENT", "OTHER"]), name: z.string().trim().min(2).max(120), mobile: mobile.optional(), email: z.string().email().optional() }).strict()).max(50).default([]),
    documents: z.array(z.object({ type: z.string().trim().min(2).max(60), number: optionalText(120), fileUrl: z.string().url().max(1000).optional(), expiresAt: z.coerce.date().optional() }).strict()).max(50).default([]),
    creditRateCard: z.array(creditRateSchema).max(SERVICE_LOCATION_NAMES.length).default([]),
    creditCharges: creditChargesSchema,
  })
  .strict();
const customerBaseSchema = customerFields.superRefine((customer, ctx) => {
  if (customer.customerType === "CREDIT" && !customer.creditRateCard.length)
    ctx.addIssue({ code: "custom", path: ["creditRateCard"], message: "Add at least one location rate" });
  const locations = customer.creditRateCard.map(({ location }) => location);
  if (new Set(locations).size !== locations.length)
    ctx.addIssue({ code: "custom", path: ["creditRateCard"], message: "A location can only be added once" });
});
export const customerSchema = customerBaseSchema;
const lrAmount = z.coerce.number().finite().min(0).max(100000000);
const goodsNumber = z.coerce.number().finite().positive().max(100000);
const goodsDimension = z.preprocess((value) => (value === "" ? undefined : value), goodsNumber.optional());
export const goodsSchema = z
  .object({
    packageNumber: z.string().trim().max(80).optional(),
    description: z.string().trim().min(1, "Enter goods description").max(500),
    packageType: z.string().trim().max(120).optional(),
    quantity: z.coerce.number().int().min(1).max(10000),
    actualWeight: z.coerce.number().finite().min(0.01).max(100000),
    length: goodsDimension,
    breadth: goodsDimension,
    height: goodsDimension,
    dimensionUnit: z.enum(["CM", "IN", "FT"]),
    volume: z.number().finite().min(0).optional(),
    volumetricWeight: z.number().finite().min(0).optional(),
    chargedWeight: z.number().finite().min(0).optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const dimensions = ["length", "breadth", "height"];
    if (dimensions.some((key) => row[key] !== undefined)) {
      for (const key of dimensions)
        if (row[key] === undefined)
          ctx.addIssue({ code: "custom", path: [key], message: "Enter all three dimensions" });
    }
  });
const goodsList = z
  .array(goodsSchema)
  .min(1)
  .max(100)
  .superRefine((rows, ctx) => {
    if (rows.reduce((sum, row) => sum + row.quantity, 0) > 10000)
      ctx.addIssue({ code: "custom", message: "Maximum 10,000 packages per LR" });
    if (rows.reduce((sum, row) => sum + row.actualWeight, 0) > 100000)
      ctx.addIssue({ code: "custom", message: "Maximum total actual weight is 100,000 kg" });
  });
const manualLrNumber = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Enter LR number")
  .max(50)
  .regex(/^[A-Z0-9][A-Z0-9/._-]*$/, "Use letters, numbers, /, ., _ or -");
export const lrDetailsSchema = z
  .object({
    goods: goodsList.optional(),
    volumetricWeight: z.number().finite().min(0).optional(),
    consignorCode: optionalText(80),
    consignorAddress: optionalText(500),
    consignorAddress2: optionalText(500),
    consignorPincode: pincode.optional(),
    consignorGstin: gstin.optional(),
    consigneeAddress: optionalText(500),
    consigneeAddress2: optionalText(500),
    consigneeAddress3: optionalText(500),
    consigneePincode: pincode.optional(),
    consigneeGstin: gstin.optional(),
    bookingDate: z.coerce.date().optional(),
    bookingBranch: optionalText(120),
    from: optionalText(120),
    to: optionalText(120),
    deliveryAddress: optionalText(500),
    contactNo: mobile.optional(),
    invoiceNo: optionalText(120),
    invoiceDate: z.coerce.date().optional(),
    eWayBillNo: optionalText(120),
    eWayBillDate: z.coerce.date().optional(),
    poStnNo: optionalText(120),
    customerReference: optionalText(250),
    packageNumber: optionalText(80),
    packageType: optionalText(120),
    actualWeight: positiveNumber.optional(),
    chargedWeight: positiveNumber.optional(),
    dimensions: optionalText(200),
    volume: z.coerce.number().finite().min(0).optional(),
    declaredValue: lrAmount.optional(),
    shipperSignature: optionalText(50000),
    remarks: optionalText(1000),
    receiverNamePrint: optionalText(120),
    receiverMobilePrint: mobile.optional(),
    receiverDateTime: z.coerce.date().optional(),
    receiverSignature: optionalText(50000),
    paymentMode: z.enum(["PAID", "TO_PAY", "CREDIT"]).optional(),
    riskType: z.enum(["CARRIER_RISK", "OWNER_RISK"]).optional(),
    insuranceType: z.enum(["INSURED", "NOT_INSURED"]).optional(),
    freightBasis: z.enum(["PER_KG", "PER_BOX", "FIXED"]).optional(),
    freightRate: lrAmount.optional(),
    fuelRatePercent: lrAmount.max(100).optional(),
    rovRatePercent: lrAmount.max(100).optional(),
    freightCharges: lrAmount.optional(),
    fuelCharges: lrAmount.optional(),
    handlingCharges: lrAmount.optional(),
    fodCodCharges: lrAmount.optional(),
    fodCharges: lrAmount.optional(),
    codCharges: lrAmount.optional(),
    rovCharges: lrAmount.optional(),
    docketCharges: lrAmount.optional(),
    gstRate: lrAmount.max(100).optional(),
    gstAmount: lrAmount.optional(),
    totalAmount: lrAmount.optional(),
  })
  .strict();
export const shipmentSchema = z
  .object({
    lrNumber: manualLrNumber,
    pickupRequestId: objectId.optional(),
    customerId: objectId,
    originBranchId: objectId,
    destinationBranchId: objectId,
    senderName: z.string().trim().min(2).max(120),
    receiverName: z.string().trim().min(2).max(120),
    receiverMobile: mobile.optional(),
    packageCount: z.coerce.number().int().min(1).max(10000),
    weightKg: z.coerce.number().min(0.01).max(100000),
    description: optionalText(500),
    expectedDeliveryDate: z.coerce.date().optional(),
    lrDetails: lrDetailsSchema.optional(),
  })
  .strict();
export const shipmentUpdateSchema = shipmentSchema
  .omit({ lrNumber: true, pickupRequestId: true, customerId: true, originBranchId: true, destinationBranchId: true })
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
export const publicTrackSchema = z.object({ lrNumber: manualLrNumber }).strict();
export const customerCodeParams = z
  .object({
    customerCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, "Customer code must be 5 digits"),
  })
  .strict();
export const publicRequestSchema = z
  .object({
    customerCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, "Customer code must be 5 digits"),
    lrNumber: manualLrNumber,
  })
  .strict();
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f\d]{64}$/i, "Invalid upload token") }).strict();
export const reportSchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    status: z.enum(Object.values(SHIPMENT_STATUS)).optional(),
    branch: objectId.optional(),
    customer: objectId.optional(),
  })
  .strict();
export const emptySchema = strictEmpty;

const nonEmptyUpdate = (schema) =>
  schema
    .partial()
    .strict()
    .refine((data) => Object.keys(data).length > 0, "Provide at least one field to update");
export const branchUpdateSchema = nonEmptyUpdate(branchSchema);
export const customerUpdateSchema = customerFields
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, "Provide at least one field to update");
export const employeePatchSchema = nonEmptyUpdate(userSchema.omit({ password: true }));
export const shipmentPatchSchema = nonEmptyUpdate(
  shipmentSchema.omit({ pickupRequestId: true, customerId: true, originBranchId: true, destinationBranchId: true }),
);

export const activitySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    search: z.string().trim().max(100).optional(),
    action: z
      .string()
      .regex(/^[A-Z_]{2,80}$/)
      .optional(),
    entityType: z
      .enum([
        "User",
        "Branch",
        "Customer",
        "Shipment",
        "ShipmentDocument",
        "UploadSession",
        "Vendor",
        "Manifest",
        "Trip",
        "DeliveryRunSheet",
        "Invoice",
        "MoneyReceipt",
        "Quotation",
        "StationeryTransaction",
        "TmsRegister",
        "Payslip",
        "EmployeeOnboarding",
        "PickupRequest",
        "PickupRunSheet",
      ])
      .optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  })
  .strict()
  .refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, "Start date must precede end date");

const amount = z.coerce.number().finite().min(0).max(1000000000);
const requiredDate = z.coerce.date();
const businessStatus = z
  .string()
  .trim()
  .regex(/^[A-Z_]{2,40}$/);
const businessListBase = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z
    .string()
    .regex(/^[a-zA-Z]+$/)
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  status: businessStatus.optional(),
  branchId: objectId.optional(),
  customerId: objectId.optional(),
  vendorId: objectId.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export const businessListSchema = businessListBase
  .strict()
  .refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, "Start date must precede end date");

const commercialSchema = z
  .object({
    rateBasis: z.enum(["PER_KG", "PER_BOX", "PER_TRIP", "FIXED"]),
    rate: amount,
    fuelSurchargePercent: amount.max(100),
    handlingCharge: amount,
    detentionPerDay: amount,
    creditDays: z.coerce.number().int().min(0).max(365),
    gstRate: amount.max(100),
  })
  .strict();
const vehicleSchema = z
  .object({
    vehicleNumber: z.string().trim().toUpperCase().min(4).max(20),
    vehicleType: optionalText(80),
    capacityKg: amount.optional(),
    driverName: optionalText(120),
    driverMobile: mobile.optional(),
    status: z.enum(Object.values(ACTIVE)).default(ACTIVE.ACTIVE),
  })
  .strict();
export const vendorSchema = z
  .object({
    vendorType: z.enum(["TRANSPORTER", "CO_LOADER", "VEHICLE_OWNER", "LAST_MILE", "BROKER", "ATTACHED", "MARKET", "FIXED_VEHICLE", "PTL", "FTL", "LOCAL", "DELIVERY"]),
    name: z.string().trim().min(2).max(150),
    legalName: optionalText(150),
    ownerName: optionalText(120),
    contactPerson: optionalText(120),
    mobile,
    email: z.string().email().optional(),
    address: optionalText(500),
    city: optionalText(100),
    state: optionalText(100),
    pincode: pincode.optional(),
    gstNumber: gstin.optional(),
    panNumber: optionalText(10),
    gstType: optionalText(40),
    registrationType: optionalText(40),
    bank: z.object({ bankName: optionalText(120), accountName: optionalText(150), accountNumber: optionalText(40), ifsc: optionalText(11), branch: optionalText(120), upi: optionalText(120) }).strict().optional(),
    verification: z.object({ bankVerified: z.boolean().default(false), gstVerified: z.boolean().default(false), panVerified: z.boolean().default(false), approvedBy: objectId.optional(), approvalDate: z.coerce.date().optional() }).strict().optional(),
    services: z.array(z.enum(["FM", "MM", "LM", "PTL", "FTL", "PICKUP", "DELIVERY", "HUB_TRANSFER", "LINE_HAUL"])).max(9).default([]),
    documents: z.array(z.object({ type: z.string().trim().min(2).max(60), number: optionalText(120), fileUrl: z.string().url().max(1000).optional(), expiresAt: z.coerce.date().optional(), verified: z.boolean().default(false) }).strict()).max(50).default([]),
    commercial: commercialSchema,
    vehicles: z.array(vehicleSchema).max(100).default([]),
  })
  .strict();
export const vendorUpdateSchema = nonEmptyUpdate(vendorSchema);

const shipmentIdList = z
  .array(objectId)
  .min(1)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate LR selected");
export const segregationSchema = z
  .object({
    branchId: objectId.optional(),
    vendorId: objectId,
    destination: z.string().trim().min(2).max(150),
    vehicleNumber: optionalText(20),
    driverName: z.string().trim().min(2).max(120),
    driverMobile: mobile.optional(),
    shipmentIds: shipmentIdList,
    remarks: optionalText(500),
  })
  .strict();
export const manifestSchema = z
  .object({
    branchId: objectId.optional(),
    segregationId: objectId.optional(),
    vendorId: objectId.optional(),
    destination: optionalText(150),
    vehicleNumber: optionalText(20),
    deliveryAgent: optionalText(120),
    shipmentIds: shipmentIdList.optional(),
    vendorReference: optionalText(120),
    remarks: optionalText(500),
  })
  .strict()
  .refine((data) => data.segregationId || (data.vendorId && data.destination && data.shipmentIds?.length), {
    path: ["segregationId"],
    message: "Select a segregation batch",
  });
export const manifestStatusSchema = z
  .object({
    coLoaderStatus: z.enum([
      "BOOKED",
      "PICKED_UP",
      "IN_TRANSIT",
      "AT_HUB",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "EXCEPTION",
    ]),
    remarks: optionalText(500),
  })
  .strict();

export const tripSchema = z
  .object({
    branchId: objectId.optional(),
    vendorId: objectId.optional(),
    vehicleNumber: z.string().trim().toUpperCase().min(4).max(20),
    driverName: z.string().trim().min(2).max(120),
    driverMobile: mobile.optional(),
    origin: z.string().trim().min(2).max(150),
    destination: z.string().trim().min(2).max(150),
    departureDate: requiredDate,
    expectedArrival: z.coerce.date().optional(),
    shipmentIds: shipmentIdList,
    freightAmount: amount.default(0),
    advanceAmount: amount.default(0),
    startKm: amount.default(0),
    endKm: amount.optional(),
    dieselAmount: amount.default(0),
    tollAmount: amount.default(0),
    otherExpense: amount.default(0),
    revenueAmount: amount.default(0),
    remarks: optionalText(500),
  })
  .strict()
  .refine((data) => !data.expectedArrival || data.expectedArrival >= data.departureDate, {
    path: ["expectedArrival"],
    message: "Expected arrival must be after departure",
  });
export const tripStatusSchema = z
  .object({ status: z.enum(["DISPATCHED", "ARRIVED", "CLOSED", "CANCELLED"]), remarks: optionalText(500) })
  .strict();

const partBSchema = z
  .object({
    eWayBillNo: z.string().trim().min(3).max(50),
    vehicleNumber: z.string().trim().toUpperCase().min(4).max(20),
  })
  .strict();
export const drsSchema = z
  .object({
    branchId: objectId.optional(),
    vehicleNumber: z.string().trim().toUpperCase().min(4).max(20),
    driverName: z.string().trim().min(2).max(120),
    driverMobile: mobile.optional(),
    deliveryDate: requiredDate,
    route: z.string().trim().min(2).max(250),
    shipmentIds: shipmentIdList,
    partB: z.array(partBSchema).max(100).default([]),
    remarks: optionalText(500),
  })
  .strict();
export const drsVehicleSchema = z
  .object({
    vehicleNumber: z.string().trim().toUpperCase().min(4).max(20),
    partB: z.array(partBSchema).max(100).optional(),
  })
  .strict();
export const drsPodParams = z.object({ id: objectId, shipmentId: objectId }).strict();

export const invoiceSchema = z
  .object({
    branchId: objectId.optional(),
    customerId: objectId,
    shipmentIds: shipmentIdList,
    periodFrom: z.coerce.date().optional(),
    periodTo: z.coerce.date().optional(),
    gstRate: amount.max(100).default(0),
    issueDate: requiredDate,
    dueDate: z.coerce.date().optional(),
    notes: optionalText(1000),
  })
  .strict()
  .refine(
    (data) => !data.periodFrom || !data.periodTo || data.periodFrom <= data.periodTo,
    "Billing period is invalid",
  );
export const invoiceStatusSchema = z
  .object({ status: z.enum(["ISSUED", "CANCELLED"]), notes: optionalText(500) })
  .strict();
const allocationSchema = z
  .object({ invoiceId: objectId, amount: z.coerce.number().finite().positive().max(1000000000) })
  .strict();
export const moneyReceiptSchema = z
  .object({
    branchId: objectId.optional(),
    customerId: objectId,
    allocations: z.array(allocationSchema).max(100).default([]),
    shipmentIds: z.array(objectId).max(500).default([]),
    receivedFrom: z.string().trim().min(2).max(150),
    amount: z.coerce.number().finite().positive().max(1000000000),
    paymentMode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
    transactionReference: optionalText(150),
    receiptDate: requiredDate,
    remarks: optionalText(500),
  })
  .strict()
  .refine((data) => data.paymentMode === "CASH" || data.transactionReference, {
    path: ["transactionReference"],
    message: "Transaction reference is required for non-cash payments",
  });

const quotationBase = z.object({
  branchId: objectId.optional(),
  customerId: objectId.optional(),
  leadName: z.string().trim().min(2).max(120),
  companyName: optionalText(150),
  billingAddress: optionalText(500),
  paymentTerms: optionalText(100),
  serviceType: z.enum(["FTL", "PTL", "PACKERS_MOVERS"]).optional(),
  validityDays: z.coerce.number().int().min(1).max(365).optional(),
  mobile,
  email: z.string().email().optional(),
  origin: z.string().trim().min(2).max(150),
  destination: z.string().trim().min(2).max(150),
  goodsDescription: z.string().trim().min(2).max(500),
  packageCount: z.coerce.number().int().min(1).max(10000),
  weightKg: z.coerce.number().finite().positive().max(100000),
  transportationRates: z.array(z.object({
    origin: z.string().trim().min(2).max(150),
    destination: z.string().trim().min(2).max(150),
    mode: z.enum(["FTL", "PTL", "PACKERS_MOVERS"]),
    rateBasis: z.enum(["PER_TRIP", "PER_KG", "PER_JOB"]),
    rate: amount,
  }).strict()).max(3).optional(),
  accessorialCharges: z.object({
    docketCharges: optionalText(120),
    rovOwnerRisk: optionalText(120),
    fod: optionalText(120),
    codHandling: optionalText(120),
    pickupCharges: optionalText(120),
    odaRemoteArea: optionalText(120),
    hamali: optionalText(120),
    reattemptDelivery: optionalText(120),
    appointmentDelivery: optionalText(120),
    detention: optionalText(120),
    storage: optionalText(120),
    specialHandling: optionalText(120),
    insurance: optionalText(120),
    gst: optionalText(120),
  }).strict().optional(),
});
export const quotationSchema = quotationBase
  .extend({
    estimatedFreight: amount.default(0),
    gstRate: amount.max(100).default(0),
    validUntil: z.coerce.date().optional(),
    notes: optionalText(1000),
  })
  .strict();
export const publicQuotationSchema = quotationBase.omit({ branchId: true, customerId: true }).strict();
export const quotationStatusSchema = z
  .object({
    status: z.enum(["QUOTED", "ACCEPTED", "REJECTED", "EXPIRED"]),
    estimatedFreight: amount.optional(),
    gstRate: amount.max(100).optional(),
    validUntil: z.coerce.date().optional(),
    notes: optionalText(1000),
  })
  .strict();

export const stationerySchema = z
  .object({
    branchId: objectId.optional(),
    itemType: z.enum(["LR_BOOK", "POD_BOOK", "MONEY_RECEIPT_BOOK", "LABEL", "OTHER"]),
    transactionType: z.enum(["RECEIVE", "ISSUE"]),
    quantity: z.coerce.number().int().min(1).max(1000000),
    serialFrom: optionalText(80),
    serialTo: optionalText(80),
    issuedToType: z.enum(["VENDOR", "FE", "BRANCH"]).optional(),
    vendorId: objectId.optional(),
    userId: objectId.optional(),
    issuedToName: optionalText(150),
    transactionDate: requiredDate,
    remarks: optionalText(500),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.transactionType === "ISSUE" && !data.issuedToType)
      ctx.addIssue({ code: "custom", path: ["issuedToType"], message: "Select who receives the stationery" });
    if (data.issuedToType === "VENDOR" && !data.vendorId)
      ctx.addIssue({ code: "custom", path: ["vendorId"], message: "Select a vendor" });
    if (data.issuedToType === "FE" && !data.userId && !data.issuedToName)
      ctx.addIssue({ code: "custom", path: ["issuedToName"], message: "Select or name the field executive" });
  });

const registerStatus = z.enum([
  "OPEN", "PLANNED", "IN_PROGRESS", "COMPLETED", "APPROVED", "PAID",
  "REJECTED", "CANCELLED", "INACTIVE",
]);
const registerFields = z.object({
  branchId: objectId.optional(),
  shipmentIds: z.array(objectId).max(500).default([]),
  vendorId: objectId.optional(),
  customerId: objectId.optional(),
  userId: objectId.optional(),
  title: z.string().trim().min(2).max(180),
  reference: optionalText(120),
  operationDate: requiredDate,
  dueDate: z.coerce.date().optional(),
  origin: optionalText(150),
  destination: optionalText(150),
  vehicleNumber: optionalText(20),
  driverName: optionalText(120),
  driverMobile: mobile.optional(),
  documentNumber: optionalText(120),
  quantity: amount.default(0),
  amount: amount.default(0),
  taxAmount: amount.default(0),
  status: registerStatus.default("OPEN"),
  description: optionalText(1000),
  remarks: optionalText(1000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const tmsRegisterSchema = registerFields.strict();
export const tmsRegisterUpdateSchema = registerFields
  .omit({ branchId: true, shipmentIds: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field");
export const tmsRegisterStatusSchema = z
  .object({ status: registerStatus, remarks: optionalText(1000) })
  .strict();
const registerResource = z.enum([
  "pickups", "ptl-operations", "ftl-operations", "hubs", "handling", "fleet", "drivers",
  "vendor-settlements", "eway-gst", "accounting", "hr", "claims", "notifications", "system-settings",
]);
export const tmsRegisterResource = z.object({ resource: registerResource }).strict();
export const tmsRegisterResourceId = z.object({ resource: registerResource, id: objectId }).strict();

const salaryAmount = z.coerce.number().finite().min(0).max(100000000);
const earningsSchema = z.object({
  basic: salaryAmount.default(0),
  hra: salaryAmount.default(0),
  conveyance: salaryAmount.default(0),
  allowance: salaryAmount.default(0),
  bonus: salaryAmount.default(0),
  other: salaryAmount.default(0),
}).strict().default({});
const deductionsSchema = z.object({
  pf: salaryAmount.default(0),
  esi: salaryAmount.default(0),
  professionalTax: salaryAmount.default(0),
  tds: salaryAmount.default(0),
  advance: salaryAmount.default(0),
  other: salaryAmount.default(0),
}).strict().default({});
export const payslipSchema = z.object({
  employeeId: objectId,
  salaryMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Select salary month"),
  designation: optionalText(120),
  department: optionalText(120),
  paidDays: z.coerce.number().finite().min(0).max(31),
  earnings: earningsSchema,
  deductions: deductionsSchema,
  paymentDate: z.coerce.date().optional(),
  paymentReference: optionalText(150),
  notes: optionalText(500),
}).strict();
export const payslipStatusSchema = z.object({ status: z.enum(["ISSUED", "CANCELLED"]) }).strict();
export const payslipListSchema = businessListBase.extend({
  employeeId: objectId.optional(),
  salaryMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
}).strict();

export const employeeOnboardingSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email(),
  mobile,
  alternateMobile: mobile.optional(),
  dateOfBirth: z.coerce.date().optional(),
  joiningDate: requiredDate,
  designation: z.string().trim().min(2).max(120),
  department: z.string().trim().min(2).max(120),
  branchId: objectId,
  address: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  pincode: pincode.optional(),
  emergencyContactName: optionalText(120),
  emergencyContactMobile: mobile.optional(),
  panNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Invalid PAN").optional(),
  aadhaarLast4: z.string().regex(/^\d{4}$/, "Enter only the last 4 Aadhaar digits").optional(),
}).strict();
export const employeeOnboardingReviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  password: z.string().min(12).max(128).optional(),
  remarks: optionalText(500),
}).strict().superRefine((data, ctx) => {
  if (data.action === "APPROVE" && !data.password)
    ctx.addIssue({ code: "custom", path: ["password"], message: "Set an initial login password" });
  if (data.action === "REJECT" && !data.remarks)
    ctx.addIssue({ code: "custom", path: ["remarks"], message: "Enter a rejection reason" });
});
export const employeeDocumentParams = z.object({
  id: objectId,
  documentType: z.enum(["ID_PROOF", "ADDRESS_PROOF", "PHOTO", "EDUCATION", "OTHER"]),
}).strict();
export const employeeDocumentFileParams = z.object({ id: objectId, documentId: objectId }).strict();
