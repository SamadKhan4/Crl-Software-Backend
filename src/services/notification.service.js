import { Customer, Notification } from "../models/index.js";
import { ROLES } from "../constants/workflow.js";
import { NotFoundError } from "../utils/errors.js";
import { listQuery, paginated } from "../utils/query.js";

const labels = { BOOKED: "LR generated", IN_TRANSIT: "Shipment dispatched", RECEIVED: "Shipment received", LR_IMAGE_UPLOADED: "POD uploaded", LR_IMAGE_VERIFIED: "POD verified", COMPLETED: "Shipment delivered", CLOSED: "Shipment closed", CANCELLED: "Shipment cancelled" };
export async function queueShipmentNotification(session, shipment, status) {
  const customer = await Customer.findById(shipment.customerId).select("name companyName mobile email").session(session).lean();
  if (!customer) return;
  const subject = labels[status] || `Shipment ${status}`;
  const channels = [...(customer.mobile ? ["WHATSAPP", "SMS"] : []), ...(customer.email ? ["EMAIL"] : [])];
  if (!channels.length) return;
  await Notification.create([{ event: status, shipmentId: shipment._id, customerId: shipment.customerId, branchId: shipment.originBranchId, recipientName: customer.companyName || customer.name, mobile: customer.mobile, email: customer.email, channels, subject, message: `${subject}: LR ${shipment.lrNumber}. Current location: ${shipment.currentLocation || "Operations"}.` }], { session });
}
export async function listNotifications(query, user) {
  const options = listQuery(query); const filter = user.role === ROLES.ADMIN ? {} : { branchId: user.branchId };
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([Notification.find(filter).populate("shipmentId", "lrNumber currentStatus").sort(options.sort).skip(options.skip).limit(options.limit).lean(), Notification.countDocuments(filter)]);
  return paginated(items, total, options);
}
export async function retryNotification(id) {
  const notification = await Notification.findById(id);
  if (!notification) throw new NotFoundError("Notification not found", "NOTIFICATION_NOT_FOUND");
  notification.status = "QUEUED"; notification.lastError = undefined; notification.attempts += 1; await notification.save();
  return { ...notification.toObject(), id: notification._id };
}
