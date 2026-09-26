const { ZodError } = require("zod");

/**
 * Validates a request against zod schemas and replies 400 with structured
 * field errors on failure. Parsed (and coerced) values are written back onto
 * req so downstream handlers get clean data.
 *
 * Usage:
 *   const { z } = require("zod");
 *   router.post("/receive",
 *     auth,
 *     validate({ body: z.object({ qty: z.coerce.number().int().positive() }) }),
 *     receiveLot);
 *
 * Accepts any subset of { body, query, params }.
 */
function validate(schemas = {}, onFailure) {
  return async (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) {
        // req.query can be a read-only getter on Express 5 — assign a shadow.
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, "validatedQuery", { value: parsed, configurable: true });
        try {
          req.query = parsed;
        } catch {
          /* express 5 makes req.query read-only; use req.validatedQuery */
        }
      }
      if (schemas.params) req.params = schemas.params.parse(req.params);
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        if (onFailure) await onFailure(req);
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      return next(err);
    }
  };
}

module.exports = validate;
