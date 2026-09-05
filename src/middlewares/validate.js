import { AppError } from "../utils/errors.js";
export const validate =
  (schema, source = "body") =>
  (req, _res, next) => {
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
