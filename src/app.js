import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { swaggerSpec } from "./config/swagger.js";
import router from "./routes/index.js";
import { errorHandler, notFound } from "./middlewares/errors.js";
export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    const supplied = req.get("X-Request-ID");
    req.id = supplied && /^[A-Za-z0-9._-]{8,128}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader("X-Request-ID", req.id);
    next();
  });
  app.use(
    pinoHttp({
      enabled: env.nodeEnv !== "test",
      customProps: (req) => ({ requestId: req.id, userId: req.user?._id?.toString() }),
      redact: [
        "req.headers.authorization",
        "req.body.password",
        "req.body.currentPassword",
        "req.body.newPassword",
        "req.body.refreshToken",
        "res.headers.set-cookie",
      ],
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 500,
      skip: () => env.nodeEnv === "development",
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({
      success: true,
      status: "healthy",
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    }),
  );
  app.get("/api/health/live", (_req, res) =>
    res.json({ success: true, status: "live", timestamp: new Date().toISOString() }),
  );
  app.get("/api/health/ready", (_req, res) => {
    const connected = mongoose.connection.readyState === 1 && !app.locals.draining;
    res.status(connected ? 200 : 503).json({
      success: connected,
      status: connected ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
    });
  });
  if (env.nodeEnv !== "production") app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.use("/api", router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};
