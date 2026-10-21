// Shared toJSON transform: expose `id` (what the frontend already uses)
// instead of Mongo's `_id` / `__v`.
function toJsonTransform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
}

module.exports = { toJsonTransform };
