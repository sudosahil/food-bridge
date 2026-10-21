// Validates one part of the request (body / query / params) against a zod
// schema and replaces it with the parsed, coerced result.
function validate(schema, part) {
    return function (req, _res, next) {
        const result = schema.safeParse(req[part || 'body']);
        if (!result.success) return next(result.error);
        // Express 5 makes req.query a getter, so store parsed values separately.
        req.valid = req.valid || {};
        req.valid[part || 'body'] = result.data;
        next();
    };
}

module.exports = { validate };
