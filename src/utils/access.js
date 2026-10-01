import { ROLES } from "../constants/workflow.js";

export const hasFullOperationsAccess = (user) =>
  [ROLES.ADMIN, ROLES.MANAGER].includes(user?.role);
