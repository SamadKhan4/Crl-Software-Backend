import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as tms from "../services/tms.service.js";

const list = (message, handler) =>
  asyncHandler(async (req, res) => successPaginated(res, message, await handler(req.query, req.user)));
const get = (message, handler) =>
  asyncHandler(async (req, res) => success(res, 200, message, await handler(req.params.id, req.user)));
const create = (message, handler) =>
  asyncHandler(async (req, res) => success(res, 201, message, await handler(req.body, req)));

export const createVendor = create("Vendor created", tms.createVendor);
export const listVendors = list("Vendors fetched", tms.listVendors);
export const vendorOptions = asyncHandler(async (req, res) =>
  success(res, 200, "Vendor options fetched", await tms.vendorOptions(req.query)),
);
export const getVendor = get("Vendor fetched", tms.getVendor);
export const updateVendor = asyncHandler(async (req, res) =>
  success(res, 200, "Vendor updated", await tms.updateVendor(req.params.id, req.body, req)),
);
export const vendorStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Vendor status updated", await tms.setVendorStatus(req.params.id, req.body.status, req)),
);

export const createSegregation = create("Segregation created", tms.createSegregation);
export const listSegregations = list("Segregations fetched", tms.listSegregations);
export const segregationOptions = asyncHandler(async (req, res) =>
  success(res, 200, "Ready segregations fetched", await tms.segregationOptions(req.query, req.user)),
);
export const segregationInventory = list("Segregation inventory fetched", tms.segregationInventory);
export const getSegregation = get("Segregation fetched", tms.getSegregation);

export const createManifest = create("Manifest created", tms.createManifest);
export const listManifests = list("Manifests fetched", tms.listManifests);
export const getManifest = get("Manifest fetched", tms.getManifest);
export const manifestStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Co-loader status updated", await tms.updateManifestStatus(req.params.id, req.body, req)),
);

export const createTrip = create("Trip created", tms.createTrip);
export const listTrips = list("Trips fetched", tms.listTrips);
export const getTrip = get("Trip fetched", tms.getTrip);
export const tripStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Trip status updated", await tms.updateTripStatus(req.params.id, req.body, req)),
);

export const createDrs = create("Delivery run sheet created", tms.createDrs);
export const listDrs = list("Delivery run sheets fetched", tms.listDrs);
export const getDrs = get("Delivery run sheet fetched", tms.getDrs);
export const updateDrsVehicle = asyncHandler(async (req, res) =>
  success(
    res,
    200,
    "DRS vehicle and e-way bill Part B updated",
    await tms.updateDrsVehicle(req.params.id, req.body, req),
  ),
);
export const uploadDrsPod = asyncHandler(async (req, res) =>
  success(res, 201, "POD uploaded", await tms.uploadDrsPod(req.params.id, req.params.shipmentId, req.file, req)),
);
export const closeDrs = asyncHandler(async (req, res) =>
  success(res, 200, "DRS closed", await tms.closeDrs(req.params.id, req)),
);

export const createInvoice = create("Invoice created", tms.createInvoice);
export const listInvoices = list("Invoices fetched", tms.listInvoices);
export const getInvoice = get("Invoice fetched", tms.getInvoice);
export const invoiceStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Invoice status updated", await tms.updateInvoiceStatus(req.params.id, req.body, req)),
);
export const receivables = asyncHandler(async (req, res) =>
  success(res, 200, "Receivables summary fetched", await tms.receivablesSummary(req.query, req.user)),
);

export const createMoneyReceipt = create("Money receipt created", tms.createMoneyReceipt);
export const listMoneyReceipts = list("Money receipts fetched", tms.listMoneyReceipts);
export const getMoneyReceipt = get("Money receipt fetched", tms.getMoneyReceipt);

export const createQuotation = create("Quotation created", tms.createQuotation);
export const createPublicQuotation = asyncHandler(async (req, res) =>
  success(res, 202, "Quotation request received", await tms.createPublicQuotation(req.body)),
);
export const listQuotations = list("Quotations fetched", tms.listQuotations);
export const getQuotation = get("Quotation fetched", tms.getQuotation);
export const quotationStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Quotation updated", await tms.updateQuotationStatus(req.params.id, req.body, req)),
);

export const createStationery = create("Stationery transaction recorded", tms.createStationeryTransaction);
export const listStationery = list("Stationery transactions fetched", tms.listStationery);
export const stationeryStock = asyncHandler(async (req, res) =>
  success(res, 200, "Stationery stock fetched", await tms.stationeryStock(req.query, req.user)),
);

export const createRegister = asyncHandler(async (req, res) =>
  success(res, 201, "TMS record created", await tms.createRegister(req.params.resource, req.body, req)),
);
export const listRegisters = asyncHandler(async (req, res) =>
  successPaginated(res, "TMS records fetched", await tms.listRegisters(req.params.resource, req.query, req.user)),
);
export const getRegister = asyncHandler(async (req, res) =>
  success(res, 200, "TMS record fetched", await tms.getRegister(req.params.resource, req.params.id, req.user)),
);
export const updateRegister = asyncHandler(async (req, res) =>
  success(res, 200, "TMS record updated", await tms.updateRegister(req.params.resource, req.params.id, req.body, req)),
);
export const updateRegisterStatus = asyncHandler(async (req, res) =>
  success(res, 200, "TMS status updated", await tms.updateRegisterStatus(req.params.resource, req.params.id, req.body, req)),
);
