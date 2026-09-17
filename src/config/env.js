import dotenv from "dotenv";
import path from "node:path";

const requestedEnv = process.env.NODE_ENV;
if (requestedEnv && requestedEnv !== "production") dotenv.config({ path: `.env.${requestedEnv}` });
else dotenv.config();
const nodeEnv = process.env.NODE_ENV || "development";
const requiredInProduction = ["MONGODB_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "CORS_ORIGIN"];
if (nodeEnv === "production") {
  for (const key of requiredInProduction) if (!process.env[key]) throw new Error(`${key} is required in production`);
  if ((process.env.JWT_ACCESS_SECRET?.length || 0) < 32 || (process.env.JWT_REFRESH_SECRET?.length || 0) < 32)
    throw new Error("JWT secrets must be at least 32 characters in production");
  if (process.env.COOKIE_SECURE !== "true") throw new Error("COOKIE_SECURE must be true in production");
  if (process.env.CORS_ORIGIN.split(",").some((origin) => origin.trim() === "*"))
    throw new Error("CORS_ORIGIN cannot include * in production");
}

const integer = (name, fallback, min, max) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
};
const refreshDays = integer("REFRESH_TOKEN_DAYS", 7, 1, 30);

export const env = Object.freeze({
  nodeEnv,
  port: integer("PORT", 5000, 1, 65535),
  mongoMaxPoolSize: integer("MONGO_MAX_POOL_SIZE", 30, 1, 500),
  mongoWaitQueueTimeoutMs: integer("MONGO_WAIT_QUEUE_TIMEOUT_MS", 5000, 100, 60000),
  shutdownTimeoutMs: integer("SHUTDOWN_TIMEOUT_MS", 30000, 1000, 60000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/crl_transport",
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  accessSecret: process.env.JWT_ACCESS_SECRET || "development-access-secret-must-be-replaced",
  refreshSecret: process.env.JWT_REFRESH_SECRET || "development-refresh-secret-must-be-replaced",
  accessExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
  refreshExpiresIn: `${refreshDays}d`,
  refreshDays,
  uploadTokenMinutes: integer("UPLOAD_TOKEN_MINUTES", 20, 5, 60),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "uploads"),
  maxFileSize: integer("MAX_FILE_SIZE", 10485760, 1024, 52428800),
  storageDriver: process.env.STORAGE_DRIVER || "local",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  cookieSecure: process.env.COOKIE_SECURE === "true",
});
