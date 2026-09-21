import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as service from "../services/booking.service.js";
export const create = asyncHandler(async (req, res) => success(res, 201, "Booking created", await service.createBooking(req.body, req)));
export const list = asyncHandler(async (req, res) => successPaginated(res, "Bookings fetched", await service.listBookings(req.query, req.user)));
export const get = asyncHandler(async (req, res) => success(res, 200, "Booking fetched", await service.getBooking(req.params.id, req.user)));
export const generate = asyncHandler(async (req, res) => success(res, 201, "LR generated from booking", await service.generateLr(req.params.id, req.body, req)));
