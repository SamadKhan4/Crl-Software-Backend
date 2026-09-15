import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ROLES } from "../constants/workflow.js";
import { AuthenticationError, AuthorizationError } from "../utils/errors.js";
import { User } from "../models/index.js";
export const authenticate = async (req, _res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new AuthenticationError();
    const payload = jwt.verify(token, env.accessSecret);
    const user = await User.findById(payload.userId).lean();
    if (!user || user.status !== "ACTIVE") throw new AuthenticationError("Account is unavailable");
    req.user = user;
    next();
  } catch (error) {
    next(error instanceof AuthenticationError ? error : new AuthenticationError("Invalid or expired access token"));
  }
};
export const allow =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user.role) ? next() : next(new AuthorizationError());
export const internalRoles = allow(ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE);
