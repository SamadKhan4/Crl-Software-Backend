import { Branch, Shipment } from "../models/index.js";
import { ROLES } from "../constants/workflow.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as authService from "../services/auth.service.js";
import * as branches from "../services/branch.service.js";
import * as customers from "../services/customer.service.js";
import * as users from "../services/user.service.js";
import * as shipments from "../services/shipment.service.js";
import { audit } from "../services/audit.service.js";
import { reportQuery, streamShipmentCsv } from "../services/report.service.js";

const setRefreshCookie = (res, token) =>
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "strict",
    maxAge: env.refreshDays * 86400000,
    path: "/api/auth",
  });
const clearRefreshCookie = (res) =>
  res.clearCookie("refreshToken", { httpOnly: true, secure: env.cookieSecure, sameSite: "strict", path: "/api/auth" });

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  setRefreshCookie(res, result.refreshToken);
  success(res, 200, "Login successful", { user: result.user, accessToken: result.accessToken });
});
export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken || req.cookies.refreshToken);
  setRefreshCookie(res, result.refreshToken);
  success(res, 200, "Token refreshed", { user: result.user, accessToken: result.accessToken });
});
export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken || req.cookies.refreshToken);
  clearRefreshCookie(res);
  success(res, 200, "Logged out successfully", null);
});
export const me = asyncHandler(async (req, res) =>
  success(res, 200, "Current user fetched", authService.safeUser(req.user)),
);
export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword);
  await audit(null, req, "PASSWORD_CHANGED", "User", req.user._id, null, { changed: true });
  clearRefreshCookie(res);
  success(res, 200, "Password changed; sign in again", null);
});

export const createUser = asyncHandler(async (req, res) =>
  success(res, 201, "Employee created successfully", await users.createEmployee(req.body, req)),
);
export const listUsers = asyncHandler(async (req, res) =>
  successPaginated(res, "Employees fetched", await users.listEmployees(req.query)),
);
export const getUser = asyncHandler(async (req, res) =>
  success(res, 200, "Employee fetched", await users.getEmployee(req.params.id)),
);
export const updateUser = asyncHandler(async (req, res) =>
  success(res, 200, "Employee updated successfully", await users.updateEmployee(req.params.id, req.body, req)),
);
export const updateUserStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Employee status updated", await users.setEmployeeStatus(req.params.id, req.body.status, req)),
);
export const resetUserPassword = asyncHandler(async (req, res) => {
  await users.resetEmployeePassword(req.params.id, req.body.newPassword, req);
  success(res, 200, "Employee password reset successfully", null);
});

export const createBranch = asyncHandler(async (req, res) =>
  success(res, 201, "Branch created successfully", await branches.createBranch(req.body, req)),
);
export const listBranches = asyncHandler(async (req, res) =>
  successPaginated(res, "Branches fetched", await branches.listBranches(req.query, req.user)),
);
export const getBranch = asyncHandler(async (req, res) =>
  success(res, 200, "Branch fetched", await branches.getBranch(req.params.id, req.user)),
);
export const updateBranch = asyncHandler(async (req, res) =>
  success(res, 200, "Branch updated successfully", await branches.updateBranch(req.params.id, req.body, req)),
);
export const updateBranchStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Branch status updated", await branches.setBranchStatus(req.params.id, req.body.status, req)),
);

export const createCustomer = asyncHandler(async (req, res) =>
  success(res, 201, "Customer created successfully", await customers.createCustomer(req.body, req)),
);
export const listCustomers = asyncHandler(async (req, res) =>
  successPaginated(res, "Customers fetched", await customers.listCustomers(req.query)),
);
export const getCustomer = asyncHandler(async (req, res) =>
  success(res, 200, "Customer fetched", await customers.getCustomer(req.params.id)),
);
export const getCustomerByCode = asyncHandler(async (req, res) =>
  success(res, 200, "Customer fetched", await customers.getCustomerByCode(req.params.customerCode)),
);
export const updateCustomer = asyncHandler(async (req, res) =>
  success(res, 200, "Customer updated successfully", await customers.updateCustomer(req.params.id, req.body, req)),
);
export const updateCustomerStatus = asyncHandler(async (req, res) =>
  success(res, 200, "Customer status updated", await customers.setCustomerStatus(req.params.id, req.body.status, req)),
);

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

export const dashboard = asyncHandler(async (req, res) => {
  const filter =
    req.user.role === ROLES.ADMIN
      ? {}
      : { $or: [{ originBranchId: req.user.branchId }, { destinationBranchId: req.user.branchId }] };
  const [counts, todayShipments, monthlyShipments, branchWise] = await Promise.all([
    Shipment.aggregate([{ $match: filter }, { $group: { _id: "$currentStatus", count: { $sum: 1 } } }]),
    Shipment.countDocuments({ ...filter, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    Shipment.countDocuments({
      ...filter,
      createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    }),
    req.user.role !== ROLES.ADMIN
      ? []
      : Shipment.aggregate([
          { $match: filter },
          { $group: { _id: "$originBranchId", count: { $sum: 1 } } },
          { $lookup: { from: Branch.collection.name, localField: "_id", foreignField: "_id", as: "branch" } },
          { $unwind: "$branch" },
          { $project: { _id: 0, branch: "$branch.name", branchCode: "$branch.branchCode", count: 1 } },
        ]),
  ]);
  const map = Object.fromEntries(counts.map((item) => [item._id, item.count]));
  success(res, 200, "Dashboard summary fetched", {
    totalShipments: counts.reduce((total, item) => total + item.count, 0),
    booked: map.BOOKED || 0,
    inTransit: map.IN_TRANSIT || 0,
    received: map.RECEIVED || 0,
    lrImageUploaded: map.LR_IMAGE_UPLOADED || 0,
    lrImageVerified: map.LR_IMAGE_VERIFIED || 0,
    completed: map.COMPLETED || 0,
    closed: map.CLOSED || 0,
    cancelled: map.CANCELLED || 0,
    todayShipments,
    monthlyShipments,
    branchWise,
  });
});
export const shipmentReport = asyncHandler(async (req, res) =>
  success(res, 200, "Shipment report fetched", await reportQuery(req.query, req.user)),
);
export const exportShipments = asyncHandler(async (req, res) => streamShipmentCsv(req.query, req.user, res));
