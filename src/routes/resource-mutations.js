import { ROLES } from "../constants/workflow.js";
import { allow } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { ids } from "../validators/schemas.js";
import { deleteResource } from "../services/delete.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
export function addResourceMutations(router, resource, schema, handler) {
  const roles =
    resource === "branches" || resource === "managers"
      ? [ROLES.ADMIN]
      : resource === "users"
        ? [ROLES.ADMIN, ROLES.MANAGER]
        : [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];
  router.patch(`/${resource}/:id`, allow(...roles), validate(ids, "params"), validate(schema), handler);
  router.delete(
    `/${resource}/:id`,
    allow(ROLES.ADMIN),
    validate(ids, "params"),
    asyncHandler(async (req, res) => {
      success(res, 200, "Record deleted successfully", await deleteResource(resource, req.params.id, req));
    }),
  );
}
