import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
import { misReport, exportMisReport } from "../services/mis-report.service.js";
import { Invoice, MoneyReceipt } from "../models/index.js";
import mongoose from "mongoose";
import { LetterAuthorization } from "../models/authorization.model.js";
import { storageService } from "../services/storage.service.js";
import { NotFoundError } from "../utils/errors.js";
import { pipeline } from "node:stream/promises";
export const list = asyncHandler(async (req, res) => {
  const report = await misReport(req.params.report, req.query);
  res.json({ success: true, data: report.rows, columns: report.columns, metrics: report.metrics, summary: report.summary, pagination: report.pagination });
});
export const exportCsv = asyncHandler(async (req, res) => exportMisReport(req.params.report, req.query, res));
export const loaDetail = asyncHandler(async (req, res) => {
  const record = await LetterAuthorization.findById(req.params.id).select("-document.storageKey -document.fileUrl").populate("branchId", "name branchCode").lean();
  if (!record) throw new NotFoundError("Authorization not found");
  success(res, 200, "Authorization fetched", record);
});
export const loaDocument = asyncHandler(async (req, res) => {
  const record = await LetterAuthorization.findById(req.params.id).lean();
  if (!record?.document || (!record.document.storageKey && !record.document.fileUrl)) throw new NotFoundError("Authorization document not available");
  const file = await storageService.open(record.document.storageKey, record.document.fileUrl);
  if (file.url) return res.redirect(file.url);
  res.setHeader("Content-Type", record.document.mimeType === "application/pdf" ? "application/pdf" : "application/octet-stream");
  res.setHeader("Content-Disposition", 'inline; filename="authorization.pdf"');
  res.setHeader("X-Content-Type-Options", "nosniff");
  await pipeline(file.stream, res);
});

export const invoicePayments = asyncHandler(async (req, res) => {
  if (!await Invoice.exists({ _id: req.params.id })) throw new NotFoundError("Invoice not found");
  const invoiceId = new mongoose.Types.ObjectId(req.params.id);
  const rows = await MoneyReceipt.aggregate([{ $match: { status: "ACTIVE", "allocations.invoiceId": invoiceId } }, { $unwind: "$allocations" }, { $match: { "allocations.invoiceId": invoiceId } }, { $project: { id: "$_id", receiptNumber: 1, receiptDate: 1, paymentMode: 1, allocatedAmount: "$allocations.amount" } }, { $sort: { receiptDate: -1, id: -1 } }]);
  success(res, 200, "Invoice payment allocations fetched", rows);
});
