import { Router } from "express";
import * as c from "../controllers/auth.controller.js";
import { validate } from "../middlewares/validate.js";
import * as v from "../validators/schemas.js";
import { authenticate } from "../middlewares/auth.js";
import { authLimiter } from "./limits.js";

const router = Router();
router.post("/auth/login", authLimiter, validate(v.loginSchema), c.login);
router.post("/auth/refresh", authLimiter, validate(v.refreshSchema), c.refresh);
router.post("/auth/logout", validate(v.refreshSchema), c.logout);
router.get("/auth/me", authenticate, c.me);
router.post("/auth/change-password", authenticate, validate(v.passwordSchema), c.changePassword);

export default router;
