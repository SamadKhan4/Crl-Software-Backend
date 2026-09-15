import mongoose from "mongoose";

export const base = { timestamps: true, versionKey: false };
export const objectId = { type: mongoose.Schema.Types.ObjectId };
