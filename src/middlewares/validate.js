import { operationsOffice } from "../services/operations-office.service.js";
import { AppError } from "../utils/errors.js";
export const validate =
  (schema, source = "body") =>
  async (req, _res, next) => {
    try {
      let objectSchema = schema;
      while (objectSchema._def?.schema) objectSchema = objectSchema._def.schema;
      const fields = objectSchema.shape || {};
      // Legacy reference fields are filled internally, never selected by operators.
      if (source === "body" && req.user && !["PUT", "PATCH"].includes(req.method)) {
        const keys = ["branchId", "originBranchId", "destinationBranchId", "receivingBranchId"].filter((key) => fields[key]);
        if (keys.length) {
          const office = await operationsOffice();
          req.body = { ...req.body };
          for (const key of keys) req.body[key] = String(office._id);
        }
      }
      if (source === "body" && req.user && ["PUT", "PATCH"].includes(req.method)) {
        req.body = { ...req.body };
        for (const key of ["branchId", "originBranchId", "destinationBranchId", "receivingBranchId"]) delete req.body[key];
      }
      if (source === "query") {
        req[source] = { ...req[source] };
        delete req[source].branchId;
        delete req[source].branch;
        delete req[source].originBranchId;
        delete req[source].destinationBranchId;
      }
    } catch (error) { return next(error); }

    const result = schema.safeParse(req[source]);
    if (!result.success)
      return next(
        new AppError(
          "Validation failed",
          422,
          "VALIDATION_ERROR",
          result.error.issues.map(({ path, message }) => ({
            field: path.join("."),
            message,
          })),
        ),
      );
    req[source] = result.data;
    next();
  };
