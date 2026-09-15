import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
import { env } from "../config/env.js";
import * as authService from "../services/auth.service.js";
import { audit } from "../services/audit.service.js";

const setRefreshCookie = (res, token) =>
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "strict",
    maxAge: env.refreshDays * 86400000,
    path: "/api/auth",
  });
const clearRefreshCookie = (res) =>
  res.clearCookie("refreshToken", { httpOnly: true, secure: env.cookieSecure, sameSite: "strict", path: "/api/auth" });

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  setRefreshCookie(res, result.refreshToken);
  success(res, 200, "Login successful", { user: result.user, accessToken: result.accessToken });
});
export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken || req.cookies.refreshToken);
  setRefreshCookie(res, result.refreshToken);
  success(res, 200, "Token refreshed", { user: result.user, accessToken: result.accessToken });
});
export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken || req.cookies.refreshToken);
  clearRefreshCookie(res);
  success(res, 200, "Logged out successfully", null);
});
export const me = asyncHandler(async (req, res) =>
  success(res, 200, "Current user fetched", authService.safeUser(req.user)),
);
export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword);
  await audit(null, req, "PASSWORD_CHANGED", "User", req.user._id, null, { changed: true });
  clearRefreshCookie(res);
  success(res, 200, "Password changed; sign in again", null);
});
