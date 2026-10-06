import { ROLES } from "../constants/workflow.js";

export const hasFullOperationsAccess = (user) =>
  [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role);

// Operations are shared across the single NGP office; role permissions still apply.
export const hasCrossBranchAccess = (user) => Boolean(user?.role);
