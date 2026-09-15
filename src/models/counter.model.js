import mongoose from "mongoose";
import { base } from "./shared.js";

const { Schema, model } = mongoose;

const counterSchema = new Schema(
  { key: { type: String, required: true, unique: true }, value: { type: Number, required: true, default: 0 } },
  base,
);

export const Counter = model("Counter", counterSchema);
