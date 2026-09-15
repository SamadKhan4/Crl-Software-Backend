import mongoose from "mongoose";
import { env } from "./env.js";
mongoose.set("strictQuery", true);
export const connectDatabase = (options = {}) =>
  mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: env.mongoMaxPoolSize,
    minPoolSize: 0,
    maxIdleTimeMS: 30000,
    waitQueueTimeoutMS: env.mongoWaitQueueTimeoutMs,
    bufferCommands: false,
    autoIndex: env.nodeEnv !== "production",
    ...options,
  });
export const disconnectDatabase = () => mongoose.disconnect();
