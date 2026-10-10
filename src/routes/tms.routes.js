import { Router } from "express";
import { allow, permit } from "../middlewares/auth.js";
import { uploadPOD } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import { ROLES } from "../constants/workflow.js";
import * as c from "../controllers/tms.controller.js";
import * as v from "../validators/schemas.js";

const router = Router();
const adminManager = allow(ROLES.ADMIN, ROLES.MANAGER);

router.post("/vendors", allow(ROLES.ADMIN), validate(v.vendorSchema), c.createVendor);
router.get("/vendors/options", validate(v.businessListSchema, "query"), c.vendorOptions);
router.get("/vendors", adminManager, validate(v.businessListSchema, "query"), c.listVendors);
router.get("/vendors/:id", adminManager, validate(v.ids, "params"), c.getVendor);
router.put("/vendors/:id", allow(ROLES.ADMIN), validate(v.ids, "params"), validate(v.vendorSchema), c.updateVendor);
router.patch(
  "/vendors/:id",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.vendorUpdateSchema),
  c.updateVendor,
);
router.patch(
  "/vendors/:id/status",
  allow(ROLES.ADMIN),
  validate(v.ids, "params"),
  validate(v.activeStatusSchema),
  c.vendorStatus,
);

router.post("/segregations", permit("MANIFEST", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.segregationSchema), c.createSegregation);
router.get("/segregations/options", permit("MANIFEST", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.segregationOptions);
router.get("/segregations/inventory", permit("MANIFEST", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.segregationInventory);
router.get("/segregations", permit("MANIFEST", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listSegregations);
router.get("/segregations/:id", permit("MANIFEST", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.getSegregation);

router.post("/manifests", permit("MANIFEST", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.manifestSchema), c.createManifest);
router.get("/manifests", permit("MANIFEST", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listManifests);
router.get("/manifests/:id", permit("MANIFEST", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.getManifest);
router.patch("/manifests/:id/status", adminManager, validate(v.ids, "params"), validate(v.manifestStatusSchema), c.manifestStatus);

router.post("/trips", permit("TRIP", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.tripSchema), c.createTrip);
router.get("/trips", permit("TRIP", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listTrips);
router.get("/trips/:id", permit("TRIP", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.getTrip);
router.patch("/trips/:id/status", adminManager, validate(v.ids, "params"), validate(v.tripStatusSchema), c.tripStatus);

router.get("/middle-mile/sorting/inventory", permit("HUB", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.sortingListSchema, "query"), c.middleMileSortingInventory);
router.get("/middle-mile/sorting", permit("LOADING", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.sortingListSchema, "query"), c.listMiddleMileSortings);
router.post("/middle-mile/sorting", permit("HUB", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.middleMileSortingSchema), c.createMiddleMileSorting);
router.post("/middle-mile/shipments/:id/hold", permit("HUB", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), validate(v.middleMileHoldSchema), c.middleMileShipmentHold);
router.post("/loading-tallies", permit("LOADING", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.loadingTallySchema), c.createLoadingTally);
router.get("/loading-tallies", permit("LOADING", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listLoadingTallies);
router.get("/loading-tallies/:id", permit("LOADING", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.getLoadingTally);
router.post("/loading-tallies/:id/scan", permit("LOADING", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), validate(v.loadingTallyScanSchema), c.scanLoadingTally);
router.post("/loading-tallies/:id/complete", permit("LOADING", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.completeLoadingTally);
router.post("/middle-mile/manifests", permit("MANIFEST", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.middleMileManifestSchema), c.createMiddleMileManifest);
router.get("/middle-mile/manifests", permit("MANIFEST", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listMiddleMileManifests);
router.post("/middle-mile/manifests/:id/finalize", permit("MANIFEST", "APPROVE", ROLES.ADMIN, ROLES.MANAGER), validate(v.ids, "params"), c.finalizeMiddleMileManifest);
router.post("/middle-mile/trips", permit("TRIP", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.middleMileTripSchema), c.createMiddleMileTrip);
router.get("/middle-mile/trips", permit("TRIP", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listMiddleMileTrips);
router.post("/middle-mile/trips/:id/dispatch", permit("TRIP", "APPROVE", ROLES.ADMIN, ROLES.MANAGER), validate(v.ids, "params"), c.dispatchMiddleMileTrip);
router.post("/middle-mile/trips/:id/arrive", permit("HUB", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.arriveMiddleMileTrip);

router.get("/last-mile/arrivals", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.lastMileArrivals);
router.post("/last-mile/unloading-tallies", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.unloadingTallySchema), c.createUnloadingTally);
router.get("/last-mile/unloading-tallies", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listUnloadingTallies);
router.get("/last-mile/unloading-tallies/:id", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.getUnloadingTally);
router.post("/last-mile/unloading-tallies/:id/scan", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), validate(v.loadingTallyScanSchema), c.scanUnloadingTally);
router.post("/last-mile/unloading-tallies/:id/complete", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), validate(v.unloadingTallyCompleteSchema), c.completeUnloadingTally);
router.patch("/last-mile/unloading-tallies/:id/qc/:shipmentId", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.drsPodParams, "params"), validate(v.lastMileQcSchema), c.updateLastMileQc);
router.post("/last-mile/unloading-tallies/:id/inward", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), validate(v.lastMileInwardSchema), c.lastMileDestinationInward);
router.get("/last-mile/drs-inventory", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.lastMileDrsInventory);
router.get("/last-mile/drs-manifests", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.lastMileDrsManifests);
router.post("/last-mile/drs", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.lastMileDrsSchema), c.createLastMileDrs);
router.get("/last-mile/drs", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listLastMileDrs);
router.get("/last-mile/drs/:id", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.getLastMileDrs);
router.post("/last-mile/drs/:id/finalize", permit("DELIVERY", "APPROVE", ROLES.ADMIN, ROLES.MANAGER), validate(v.ids, "params"), c.finalizeLastMileDrs);
router.post("/last-mile/drs/:id/dispatch", permit("DELIVERY", "APPROVE", ROLES.ADMIN, ROLES.MANAGER), validate(v.ids, "params"), c.dispatchLastMileDrs);
router.post("/last-mile/drs/:id/attempt/:shipmentId", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.drsPodParams, "params"), validate(v.deliveryAttemptSchema), c.recordLastMileAttempt);
router.post("/last-mile/drs/:id/pod/:shipmentId", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.drsPodParams, "params"), uploadPOD, c.uploadDrsPod);
router.post("/last-mile/drs/:id/close", permit("DELIVERY", "APPROVE", ROLES.ADMIN, ROLES.MANAGER), validate(v.ids, "params"), c.closeLastMileDrs);

router.post("/drs", permit("DELIVERY", "ADD", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.drsSchema), c.createDrs);
router.get("/drs", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.businessListSchema, "query"), c.listDrs);
router.get("/drs/:id", permit("DELIVERY", "VIEW", ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE), validate(v.ids, "params"), c.getDrs);
router.patch("/drs/:id/vehicle", adminManager, validate(v.ids, "params"), validate(v.drsVehicleSchema), c.updateDrsVehicle);
router.post("/drs/:id/pod/:shipmentId", adminManager, validate(v.drsPodParams, "params"), uploadPOD, c.uploadDrsPod);
router.post("/drs/:id/close", adminManager, validate(v.ids, "params"), c.closeDrs);

router.post("/invoices", adminManager, validate(v.invoiceSchema), c.createInvoice);
router.get("/invoices", adminManager, validate(v.businessListSchema, "query"), c.listInvoices);
router.get("/invoices/:id", adminManager, validate(v.ids, "params"), c.getInvoice);
router.patch(
  "/invoices/:id/status",
  adminManager,
  validate(v.ids, "params"),
  validate(v.invoiceStatusSchema),
  c.invoiceStatus,
);
router.get("/receivables/summary", adminManager, validate(v.businessListSchema, "query"), c.receivables);

router.post("/money-receipts", adminManager, validate(v.moneyReceiptSchema), c.createMoneyReceipt);
router.get("/money-receipts", adminManager, validate(v.businessListSchema, "query"), c.listMoneyReceipts);
router.get("/money-receipts/:id", adminManager, validate(v.ids, "params"), c.getMoneyReceipt);

router.post("/quotations", adminManager, validate(v.quotationSchema), c.createQuotation);
router.get("/quotations", adminManager, validate(v.businessListSchema, "query"), c.listQuotations);
router.get("/quotations/:id", adminManager, validate(v.ids, "params"), c.getQuotation);
router.patch(
  "/quotations/:id/status",
  adminManager,
  validate(v.ids, "params"),
  validate(v.quotationStatusSchema),
  c.quotationStatus,
);

router.post("/stationery", adminManager, validate(v.stationerySchema), c.createStationery);
router.get("/stationery", adminManager, validate(v.businessListSchema, "query"), c.listStationery);
router.get("/stationery/stock", adminManager, validate(v.businessListSchema, "query"), c.stationeryStock);

const operationalRegisters = new Set(["pickups", "ptl-operations", "ftl-operations", "hubs", "handling"]);
const registerAccess = (req, res, next) =>
  operationalRegisters.has(req.params.resource) ? next() : adminManager(req, res, next);
const registerModule = (resource) => ({ pickups: "PICKUP", "ptl-operations": "PTL", "ftl-operations": "FTL", hubs: "HUB", handling: "LOADING" }[resource]);
const registerPermission = (action) => (req, res, next) =>
  operationalRegisters.has(req.params.resource)
    ? permit(registerModule(req.params.resource), action, ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE)(req, res, next)
    : next();
router.post(
  "/tms-registers/:resource",
  validate(v.tmsRegisterResource, "params"),
  registerAccess,
  registerPermission("ADD"),
  validate(v.tmsRegisterSchema),
  c.createRegister,
);
router.get(
  "/tms-registers/:resource",
  validate(v.tmsRegisterResource, "params"),
  registerAccess,
  registerPermission("VIEW"),
  validate(v.businessListSchema, "query"),
  c.listRegisters,
);
router.get(
  "/tms-registers/:resource/:id",
  validate(v.tmsRegisterResourceId, "params"),
  registerAccess,
  registerPermission("VIEW"),
  c.getRegister,
);
router.put(
  "/tms-registers/:resource/:id",
  validate(v.tmsRegisterResourceId, "params"),
  adminManager,
  validate(v.tmsRegisterUpdateSchema),
  c.updateRegister,
);
router.patch(
  "/tms-registers/:resource/:id/status",
  validate(v.tmsRegisterResourceId, "params"),
  adminManager,
  validate(v.tmsRegisterStatusSchema),
  c.updateRegisterStatus,
);

export default router;
