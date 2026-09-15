import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import { env } from "../config/env.js";
import * as shipments from "../services/shipment.service.js";

export const createShipment = asyncHandler(async (req, res) => {
  const result = await shipments.createShipment(req.body, req, req.get("Idempotency-Key"));
  success(
    res,
    result.replayed ? 200 : 201,
    result.replayed ? "Shipment creation request replayed" : "Shipment created successfully",
    result.shipment,
  );
});
export const listShipments = asyncHandler(async (req, res) =>
  successPaginated(res, "Shipments fetched", await shipments.listShipments(req.query, req.user)),
);
export const shipmentDetails = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment fetched", await shipments.shipmentDetails(req.params.id, req.user)),
);
export const shipmentHistory = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment history fetched", await shipments.shipmentHistory(req.params.id, req.user)),
);
export const downloadDocument = asyncHandler(async (req, res) => {
  const document = await shipments.openDocument(req.params.id, req.params.documentId, req.user);
  if (document.url) return res.redirect(302, document.url);
  res.type(document.mimeType);
  res.attachment(document.originalFileName);
  document.stream.pipe(res);
});
export const updateShipment = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment updated successfully", await shipments.updateShipment(req.params.id, req.body, req)),
);
export const adminOverride = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment admin override recorded", await shipments.adminOverride(req.params.id, req.body, req)),
);
export const updateStatus = asyncHandler(async (req, res) =>
  success(
    res,
    200,
    "Shipment status updated",
    await shipments.transition(req.params.id, req.body.status, req.body, req),
  ),
);
export const receiveShipment = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment marked received", await shipments.receive(req.params.id, req.body, req)),
);
export const uploadLRImage = asyncHandler(async (req, res) =>
  success(res, 201, "LR document uploaded successfully", await shipments.uploadLR(req.params.id, req.file, req)),
);
export const verifyLRImage = asyncHandler(async (req, res) =>
  success(res, 200, "LR document verification recorded", await shipments.verifyLR(req.params.id, req.body, req)),
);
export const completeShipment = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment completed", await shipments.complete(req.params.id, req)),
);
export const closeShipment = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment closed", await shipments.close(req.params.id, req)),
);
export const createUploadToken = asyncHandler(async (req, res) =>
  success(res, 201, "One-time customer upload token created", {
    token: await shipments.createInternalUploadSession(req.params.id, req),
    expiresInMinutes: env.uploadTokenMinutes,
  }),
);

export const publicTrack = asyncHandler(async (req, res) =>
  success(res, 200, "Tracking information fetched", await shipments.publicTrack(req.params.lrNumber)),
);
export const requestPublicUpload = asyncHandler(async (req, res) =>
  success(
    res,
    202,
    "If the provided shipment is eligible for document upload, an upload session has been created.",
    await shipments.requestPublicUploadSession(req.body, req),
  ),
);
export const publicUploadLR = asyncHandler(async (req, res) =>
  success(res, 201, "Document uploaded successfully", await shipments.uploadPublicLR(req.params.token, req.file, req)),
);
