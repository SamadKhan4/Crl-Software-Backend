import rateLimit from "express-rate-limit";
const limit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message, errorCode: "RATE_LIMIT_EXCEEDED", errors: [] },
  });
export const authLimiter = limit(15 * 60 * 1000, 10, "Too many authentication attempts");
export const publicLimiter = limit(15 * 60 * 1000, 60, "Too many public tracking requests");
export const publicUploadLimiter = limit(15 * 60 * 1000, 8, "Too many upload attempts");
export const internalLimiter = limit(15 * 60 * 1000, 500, "Too many API requests");
