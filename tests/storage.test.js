import fs from "node:fs/promises";
import path from "node:path";
import { LocalStorageService } from "../src/services/storage.service.js";

describe("LR file validation", () => {
  const storage = new LocalStorageService();

  test("accepts a real PDF signature and removes the stored file", async () => {
    const saved = await storage.saveLRDocument("test-shipment", {
      buffer: Buffer.from("%PDF-1.7\n"),
      mimetype: "application/pdf",
      originalname: "lr.pdf",
      size: 9,
    });
    await expect(fs.access(`${process.env.UPLOAD_DIR || "uploads"}/${saved.storageKey}`)).resolves.toBeUndefined();
    await storage.remove(saved.storageKey);
  });

  test("rejects a MIME-spoofed LR upload", async () => {
    await expect(
      storage.saveLRDocument("test-shipment", {
        buffer: Buffer.from("not a png"),
        mimetype: "image/png",
        originalname: "lr.png",
        size: 9,
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_FILE_TYPE" });
  });

  afterAll(async () => {
    await fs.rm(path.resolve(process.env.UPLOAD_DIR || "uploads", "shipments", "test-shipment"), {
      recursive: true,
      force: true,
    });
  });
});
