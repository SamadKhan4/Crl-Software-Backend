import { isBranchScopedEmployee } from "../utils/access.js";
import { AuthorizationError } from "../utils/errors.js";

export function operationAccess(req, _res, next) {
  if (!isBranchScopedEmployee(req.user)) return next();
  const path = req.path;
  let stages;
  if (/^\/middle-mile\/trips\/[^/]+\/arrive$/.test(path)) stages = ["MM", "LM"];
  else
  if (/^\/(bookings|pickups|pickup-requests|pickup-run-sheets|agent-lrs)(\/|$)/.test(path)) stages = ["FM"];
  else if (/^\/(middle-mile|loading-tallies|segregations|manifests|trips|hubs|handling)(\/|$)/.test(path)) stages = ["MM"];
  else if (/^\/(last-mile|drs)(\/|$)/.test(path)) stages = ["LM"];
  else if (/^\/shipments(\/|$)/.test(path)) stages = path === "/shipments" && req.method === "POST" ? ["FM"] : ["FM", "MM", "LM"];
  else if (/^\/package-barcodes(\/|$)/.test(path)) stages = ["MM", "LM"];
  else if (path === "/dashboard/summary") stages = [];
  if (stages && (!req.user.branchId || !stages.some((stage) => req.user.operationStages.includes(stage))))
    return next(new AuthorizationError("This operation is not assigned to your employee account"));
  next();
}
