import { Router } from "express";
import { allow } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { ROLES } from "../constants/workflow.js";
import { ids } from "../validators/schemas.js";
import * as v from "../validators/expansion.schemas.js";
import * as c from "../controllers/expansion.controller.js";

const router = Router();
const adminManager = allow(ROLES.ADMIN, ROLES.MANAGER);

router.get("/master-data/expiring-documents", adminManager, c.expiringDocuments);
router.post("/master-data", adminManager, validate(v.masterSchema), c.createMaster);
router.get("/master-data", adminManager, validate(v.masterListSchema, "query"), c.listMasters);
router.get("/master-data/:id", adminManager, validate(ids, "params"), c.getMaster);
router.put("/master-data/:id", adminManager, validate(ids, "params"), validate(v.masterUpdateSchema), c.updateMaster);

router.post("/rate-cards/quote", validate(v.rateQuoteSchema), c.quoteRate);
router.post("/rate-cards", adminManager, validate(v.rateCardSchema), c.createRateCard);
router.get("/rate-cards", adminManager, validate(v.rateListSchema, "query"), c.listRateCards);
router.put("/rate-cards/:id", adminManager, validate(ids, "params"), validate(v.rateCardUpdateSchema), c.updateRateCard);

router.get("/package-barcodes", validate(v.packageListSchema, "query"), c.listPackages);
router.get("/package-barcodes/:barcode", validate(v.packageBarcodeParams, "params"), c.packageByBarcode);
router.post("/package-barcodes/:barcode/scan", validate(v.packageBarcodeParams, "params"), validate(v.packageScanSchema), c.scanPackage);
router.post("/package-barcodes/:barcode/reprint", adminManager, validate(v.packageBarcodeParams, "params"), c.reprintPackage);

router.get("/profitability", adminManager, validate(v.profitabilitySchema, "query"), c.profitability);
router.get("/accounting/summary", adminManager, c.accountingSummary);

export default router;
