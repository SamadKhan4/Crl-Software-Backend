import { AppError } from "../utils/errors.js";
export const notFound = (req, _res, next) =>
  next(new AppError(`Route ${req.method} ${req.originalUrl} was not found`, 404, "ROUTE_NOT_FOUND"));
export const errorHandler = (error, req, res, _next) => {
  const duplicate = error?.code === 11000;
  const appError = duplicate ? new AppError("A record with this value already exists", 409, "DUPLICATE_RECORD") : error;
  const status = appError instanceof AppError ? appError.statusCode : 500;
  req.log?.error(
    { requestId: req.id, status, errorCode: appError.errorCode, message: error.message },
    "Request failed",
  );
  res.status(status).json({
    success: false,
    message: appError instanceof AppError ? appError.message : "Internal server error",
    errorCode: appError instanceof AppError ? appError.errorCode : "INTERNAL_ERROR",
    errors: appError instanceof AppError ? appError.errors : [],
    requestId: req.id,
  });
};
