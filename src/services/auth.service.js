import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { RefreshToken, User } from "../models/index.js";
import { AuthenticationError, BusinessRuleError, NotFoundError } from "../utils/errors.js";
import { userDto } from "./user.service.js";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const buildTokens = (user, familyId) => ({
  accessToken: jwt.sign({ userId: user._id.toString(), role: user.role }, env.accessSecret, {
    expiresIn: env.accessExpiresIn,
  }),
  refreshToken: jwt.sign({ userId: user._id.toString(), familyId, nonce: crypto.randomUUID() }, env.refreshSecret, {
    expiresIn: env.refreshExpiresIn,
  }),
});
const saveRefreshToken = (userId, familyId, token) =>
  RefreshToken.create({
    userId,
    familyId,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + env.refreshDays * 86400000),
  });

export const safeUser = userDto;

export async function login({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    throw new AuthenticationError("Invalid email or password", "INVALID_CREDENTIALS");
  if (user.status !== "ACTIVE") throw new AuthenticationError("Account is inactive", "USER_DISABLED");
  const familyId = crypto.randomUUID();
  const tokenPair = buildTokens(user, familyId);
  await Promise.all([
    saveRefreshToken(user._id, familyId, tokenPair.refreshToken),
    User.updateOne({ _id: user._id }, { lastLoginAt: new Date() }),
  ]);
  return { user: safeUser(user), ...tokenPair };
}

export async function refresh(refreshToken) {
  if (!refreshToken) throw new AuthenticationError("Refresh token is required", "INVALID_REFRESH_TOKEN");
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.refreshSecret);
  } catch {
    throw new AuthenticationError("Invalid or expired refresh token", "INVALID_REFRESH_TOKEN");
  }
  const tokenHash = hash(refreshToken);
  const record = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { revokedAt: new Date(), replacedAt: new Date() },
    { new: true },
  );
  if (!record) {
    const reused = await RefreshToken.findOne({ tokenHash });
    if (reused?.revokedAt)
      await RefreshToken.updateMany({ familyId: reused.familyId, revokedAt: null }, { revokedAt: new Date() });
    throw new AuthenticationError("Refresh token is invalid or already used", "INVALID_REFRESH_TOKEN");
  }
  const user = await User.findById(payload.userId);
  if (!user || user.status !== "ACTIVE") throw new AuthenticationError("Account is unavailable", "USER_DISABLED");
  const pair = buildTokens(user, record.familyId);
  await saveRefreshToken(user._id, record.familyId, pair.refreshToken);
  return { user: safeUser(user), ...pair };
}

export const logout = (refreshToken) =>
  refreshToken
    ? RefreshToken.updateOne({ tokenHash: hash(refreshToken), revokedAt: null }, { revokedAt: new Date() })
    : null;

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new NotFoundError("User not found", "USER_NOT_FOUND");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash)))
    throw new BusinessRuleError("Current password is incorrect", "INVALID_PASSWORD");
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}
