import { Router } from "express";
import * as c from "../controllers/shipments.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { uploadLR } from "../middlewares/upload.js";
import { publicLimiter, publicUploadLimiter } from "./limits.js";

const router = Router();
router.get("/public/track/:lrNumber", publicLimiter, validate(v.publicTrackSchema, "params"), c.publicTrack);
router.get(
  "/track",
  publicLimiter,
  (req, _res, next) => {
    req.params.lrNumber = req.query.lrNumber;
    next();
  },
  validate(v.publicTrackSchema, "params"),
  c.publicTrack,
);
router.post("/public/lr-upload/request", publicUploadLimiter, validate(v.publicRequestSchema), c.requestPublicUpload);
router.post(
  "/public/lr-upload/:token",
  publicUploadLimiter,
  validate(v.tokenSchema, "params"),
  uploadLR,
  c.publicUploadLR,
);

export default router;
