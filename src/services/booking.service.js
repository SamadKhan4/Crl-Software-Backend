import { Booking, Branch, Customer } from "../models/index.js";
import { ACTIVE, ROLES } from "../constants/workflow.js";
import { audit } from "./audit.service.js";
import { createShipment } from "./shipment.service.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";

export async function createBooking(data, req) {
  const branchId = req.user.role === ROLES.ADMIN ? data.branchId : req.user.branchId;
  const [customer, origin, destination] = await Promise.all([Customer.exists({ _id: data.customerId, status: ACTIVE.ACTIVE }), Branch.findById(branchId).lean(), Branch.findById(data.destinationBranchId).lean()]);
  if (!customer || !origin || !destination) throw new ConflictError("Select active customer and branches", "INVALID_BOOKING_REFERENCE");
  const record = await Booking.create({ ...data, branchId, bookingNumber: await generateBusinessNumber("booking", "BKG"), createdBy: req.user._id });
  await audit(null, req, "BOOKING_CREATED", "Booking", record._id, null, { bookingNumber: record.bookingNumber, status: record.status });
  return { ...record.toObject(), id: record._id };
}
export async function listBookings(query, user) {
  const options = listQuery(query); const filter = user.role === ROLES.ADMIN ? {} : { branchId: user.branchId };
  if (query.status) filter.status = query.status;
  if (query.search) filter.$or = ["bookingNumber", "consignor", "consignee", "origin", "destination"].map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, total] = await Promise.all([Booking.find(filter).populate("customerId", "customerCode name companyName").populate("branchId destinationBranchId", "branchCode name city").populate("shipmentId", "lrNumber currentStatus").sort(options.sort).skip(options.skip).limit(options.limit).lean(), Booking.countDocuments(filter)]);
  return paginated(items, total, options);
}
export async function getBooking(id, user) {
  const record = await Booking.findById(id).populate("customerId branchId destinationBranchId shipmentId");
  if (!record || (user.role !== ROLES.ADMIN && String(record.branchId?._id || record.branchId) !== String(user.branchId))) throw new NotFoundError("Booking not found", "BOOKING_NOT_FOUND");
  return { ...record.toObject(), id: record._id };
}
export async function generateLr(id, data, req) {
  const booking = await Booking.findById(id).populate("branchId destinationBranchId");
  if (!booking || (req.user.role !== ROLES.ADMIN && String(booking.branchId._id) !== String(req.user.branchId))) throw new NotFoundError("Booking not found", "BOOKING_NOT_FOUND");
  if (booking.status === "LR_GENERATED") throw new ConflictError("LR already generated for booking", "BOOKING_ALREADY_CONVERTED");
  if (booking.status === "CANCELLED") throw new ConflictError("Cancelled booking cannot generate LR", "BOOKING_CANCELLED");
  const payload = {
    lrNumber: data.lrNumber, customerId: String(booking.customerId), originBranchId: String(booking.branchId._id), destinationBranchId: String(booking.destinationBranchId._id),
    senderName: booking.consignor, receiverName: booking.consignee, receiverMobile: booking.consigneeMobile,
    packageCount: booking.packageCount, weightKg: booking.weightKg, description: booking.description, expectedDeliveryDate: booking.expectedDeliveryDate,
    lrDetails: { bookingDate: booking.bookingDate, bookingBranch: booking.branchId.name, from: booking.origin, to: booking.destination, invoiceNo: booking.invoiceNumber, eWayBillNo: booking.eWayBillNumber, goods: [{ description: booking.description, packageType: "BOX", quantity: booking.packageCount, actualWeight: booking.weightKg, dimensionUnit: "CM" }] },
  };
  const result = await createShipment(payload, req, `booking:${booking._id}`);
  booking.status = "LR_GENERATED"; booking.shipmentId = result.shipment.id || result.shipment._id; await booking.save();
  await audit(null, req, "BOOKING_LR_GENERATED", "Booking", booking._id, null, { bookingNumber: booking.bookingNumber, lrNumber: data.lrNumber });
  return { booking: { ...booking.toObject(), id: booking._id }, shipment: result.shipment };
}
