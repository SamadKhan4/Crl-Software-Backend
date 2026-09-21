import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as service from "../services/expansion.service.js";

export const createMaster = asyncHandler(async (req, res) => success(res, 201, "Master record created", await service.createMaster(req.body, req)));
export const listMasters = asyncHandler(async (req, res) => successPaginated(res, "Master records fetched", await service.listMasters(req.query, req.user)));
export const getMaster = asyncHandler(async (req, res) => success(res, 200, "Master record fetched", await service.getMaster(req.params.id, req.user)));
export const updateMaster = asyncHandler(async (req, res) => success(res, 200, "Master record updated", await service.updateMaster(req.params.id, req.body, req)));
export const expiringDocuments = asyncHandler(async (req, res) => success(res, 200, "Expiring documents fetched", await service.expiringDocuments(req.query, req.user)));
export const createRateCard = asyncHandler(async (req, res) => success(res, 201, "Rate card created", await service.createRateCard(req.body, req)));
export const listRateCards = asyncHandler(async (req, res) => successPaginated(res, "Rate cards fetched", await service.listRateCards(req.query)));
export const updateRateCard = asyncHandler(async (req, res) => success(res, 200, "Rate card updated", await service.updateRateCard(req.params.id, req.body, req)));
export const quoteRate = asyncHandler(async (req, res) => success(res, 200, "Rate calculated", await service.quoteRate(req.body)));
export const listPackages = asyncHandler(async (req, res) => successPaginated(res, "Package barcodes fetched", await service.listPackages(req.query, req.user)));
export const packageByBarcode = asyncHandler(async (req, res) => success(res, 200, "Package barcode fetched", await service.packageByBarcode(req.params.barcode, req.user)));
export const scanPackage = asyncHandler(async (req, res) => success(res, 200, "Package scan recorded", await service.scanPackage(req.params.barcode, req.body, req)));
export const reprintPackage = asyncHandler(async (req, res) => success(res, 200, "Package barcode marked as reprinted", await service.reprintPackage(req.params.barcode, req)));
export const profitability = asyncHandler(async (req, res) => success(res, 200, "Profitability calculated", await service.profitability(req.query, req.user)));
export const accountingSummary = asyncHandler(async (req, res) => success(res, 200, "Accounting summary fetched", await service.accountingSummary(req.query, req.user)));
