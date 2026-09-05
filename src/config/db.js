import mongoose from "mongoose";
import { env } from "./env.js";
mongoose.set("strictQuery", true);
export const connectDatabase = () =>
  mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000, autoIndex: env.nodeEnv !== "production" });
export const disconnectDatabase = () => mongoose.disconnect();
