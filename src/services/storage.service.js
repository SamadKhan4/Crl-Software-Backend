import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const fileTypes = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};
const extensionFor = (file) => path.extname(file.originalname || "").toLowerCase();
const hasSignature = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mimeType === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === "image/png")
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp")
    return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return mimeType === "application/pdf" && buffer.subarray(0, 5).toString() === "%PDF-";
};
const validateFile = (file) => {
  const extensions = fileTypes[file?.mimetype];
  if (!file?.buffer || !extensions?.includes(extensionFor(file)) || !hasSignature(file.buffer, file.mimetype))
    throw new AppError("Invalid upload file", 422, "INVALID_FILE_TYPE");
};
const metadata = (file, storageKey, fileUrl) => ({
  storageKey,
  fileUrl,
  originalFileName: path.basename(file.originalname),
  mimeType: file.mimetype,
  fileSize: file.size,
  checksum: crypto.createHash("sha256").update(file.buffer).digest("hex"),
});

export class LocalStorageService {
  #absolutePath(storageKey) {
    const absolute = path.resolve(env.uploadDir, storageKey);
    if (!absolute.startsWith(`${env.uploadDir}${path.sep}`))
      throw new AppError("Invalid storage key", 500, "STORAGE_ERROR");
    return absolute;
  }

  async saveDocument(shipmentId, documentType, file) {
    validateFile(file);
    const extension = extensionFor(file);
    const relative = path.posix.join(
      "shipments",
      shipmentId.toString(),
      documentType,
      `${crypto.randomUUID()}${extension}`,
    );
    const absolute = path.join(env.uploadDir, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, file.buffer, { flag: "wx" });
    return metadata(file, relative);
  }

  async saveLRDocument(shipmentId, file) {
    return this.saveDocument(shipmentId, "lr", file);
  }

  async remove(storageKey) {
    if (!storageKey) return;
    await fs.rm(this.#absolutePath(storageKey), { force: true });
  }

  async open(storageKey) {
    const absolute = this.#absolutePath(storageKey);
    try {
      await fs.access(absolute);
    } catch {
      throw new AppError("Stored document is unavailable", 404, "DOCUMENT_FILE_NOT_FOUND");
    }
    return { stream: fsSync.createReadStream(absolute) };
  }
}

export class CloudStorageService {
  #configured() {
    return Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);
  }

  async saveDocument(shipmentId, documentType, file) {
    validateFile(file);
    if (!this.#configured()) throw new AppError("Cloud storage is not configured", 503, "STORAGE_UNAVAILABLE");
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `crl/shipments/${shipmentId}/${documentType}/${crypto.randomUUID()}`;
    const signature = crypto
      .createHash("sha1")
      .update(`public_id=${publicId}&timestamp=${timestamp}${env.cloudinary.apiSecret}`)
      .digest("hex");
    const body = new FormData();
    body.set("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    body.set("api_key", env.cloudinary.apiKey);
    body.set("timestamp", String(timestamp));
    body.set("public_id", publicId);
    body.set("signature", signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/auto/upload`, {
      method: "POST",
      body,
    });
    if (!response.ok) throw new AppError("Cloud storage upload failed", 503, "STORAGE_UNAVAILABLE");
    const result = await response.json();
    return metadata(file, result.public_id, result.secure_url);
  }

  async saveLRDocument(shipmentId, file) {
    return this.saveDocument(shipmentId, "lr", file);
  }

  async remove(storageKey) {
    if (!storageKey || !this.#configured()) return;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHash("sha1")
      .update(`public_id=${storageKey}&timestamp=${timestamp}${env.cloudinary.apiSecret}`)
      .digest("hex");
    const body = new URLSearchParams({
      public_id: storageKey,
      timestamp: String(timestamp),
      api_key: env.cloudinary.apiKey,
      signature,
    });
    await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/resources/image/destroy`, {
      method: "POST",
      body,
    });
  }

  async open(_storageKey, fileUrl) {
    if (!fileUrl) throw new AppError("Stored document is unavailable", 404, "DOCUMENT_FILE_NOT_FOUND");
    return { url: fileUrl };
  }
}

export const storageService =
  env.storageDriver === "cloudinary" ? new CloudStorageService() : new LocalStorageService();
