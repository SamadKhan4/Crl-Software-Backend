import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "../utils/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as onboarding from "../services/onboarding.service.js";

export const create = asyncHandler(async (req, res) => success(res, 201, "Employee onboarding submitted", await onboarding.createOnboarding(req.body, req)));
export const list = asyncHandler(async (req, res) => successPaginated(res, "Employee onboarding records fetched", await onboarding.listOnboarding(req.query, req.user)));
export const get = asyncHandler(async (req, res) => success(res, 200, "Employee onboarding record fetched", await onboarding.getOnboarding(req.params.id, req.user)));
export const upload = asyncHandler(async (req, res) => success(res, 201, "Employee document uploaded", await onboarding.uploadDocument(req.params.id, req.params.documentType, req.file, req)));
export const review = asyncHandler(async (req, res) => success(res, 200, "Employee onboarding reviewed", await onboarding.reviewOnboarding(req.params.id, req.body, req)));
export const download = asyncHandler(async (req, res) => {
  const document = await onboarding.openDocument(req.params.id, req.params.documentId, req.user);
  let stream = document.stream;
  if (document.url) {
    const response = await fetch(document.url);
    if (!response.ok || !response.body) throw new AppError("Employee document is unavailable", 503, "STORAGE_UNAVAILABLE");
    stream = Readable.fromWeb(response.body);
  }
  res.type(document.mimeType);
  res.attachment(document.originalFileName);
  await pipeline(stream, res);
});
