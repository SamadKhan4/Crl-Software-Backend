import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxFileSize, files: 1 },
  fileFilter: (_req, file, callback) =>
    callback(
      allowed.has(file.mimetype)
        ? null
        : new AppError("Only JPG, PNG, WEBP, and PDF files are allowed", 422, "INVALID_FILE_TYPE"),
      allowed.has(file.mimetype),
    ),
}).single("lrImage");
export const uploadLR = (req, res, next) =>
  multerUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError)
      return next(
        new AppError(
          error.code === "LIMIT_FILE_SIZE" ? "File exceeds allowed size" : error.message,
          422,
          error.code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : "FILE_UPLOAD_ERROR",
        ),
      );
    return next(error);
  });
