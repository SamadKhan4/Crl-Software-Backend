import { Router } from "express";
import { allow } from "../middlewares/auth.js";
import { ROLES } from "../constants/workflow.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
import { DeliveryRunSheet, Manifest, TmsRegister, Trip, Vendor } from "../models/index.js";
import { AuthorizationError } from "../utils/errors.js";

const router = Router();
router.use("/vendor-portal", allow(ROLES.VENDOR));
router.get("/vendor-portal/summary", asyncHandler(async (req, res) => {
  if (!req.user.vendorId) throw new AuthorizationError("Vendor account is not mapped");
  const vendorId = req.user.vendorId;
  const [vendor, trips, manifests, settlements] = await Promise.all([
    Vendor.findById(vendorId).select("vendorCode name status services vehicles").lean(),
    Trip.find({ vendorId }).populate("shipmentIds", "lrNumber currentStatus senderName receiverName").sort({ createdAt: -1 }).limit(100).lean(),
    Manifest.find({ vendorId }).populate("shipmentIds", "lrNumber currentStatus").sort({ createdAt: -1 }).limit(100).lean(),
    TmsRegister.find({ vendorId, module: "VENDOR_SETTLEMENT" }).sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  const shipmentIds = [...new Set([...trips, ...manifests].flatMap((record) => record.shipmentIds.map((item) => String(item._id || item))))];
  const deliveries = shipmentIds.length ? await DeliveryRunSheet.find({ shipmentIds: { $in: shipmentIds } }).select("drsNumber deliveryDate route shipmentIds podShipmentIds status").sort({ createdAt: -1 }).lean() : [];
  const outstanding = settlements.filter((item) => !["PAID", "CANCELLED"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  success(res, 200, "Vendor portal fetched", { vendor, trips, manifests, deliveries, settlements, outstanding });
}));
export default router;
