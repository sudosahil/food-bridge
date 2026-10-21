const { ZodError } = require('zod');
const multer = require('multer');
const AppError = require('../utils/AppError');

function describeZodError(error) {
    const issue = error.issues[0];
    const field = issue.path.length ? issue.path.join('.') + ': ' : '';
    return field + issue.message;
}

function toAppError(err) {
    if (err instanceof AppError) return err;
    if (err instanceof ZodError) return new AppError(422, 'VALIDATION_ERROR', describeZodError(err));
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 3 MB).' : 'Invalid photo upload.';
        return new AppError(422, 'INVALID_UPLOAD', message);
    }
    if (err && err.code === 11000) return new AppError(409, 'DUPLICATE', 'That record already exists.');
    if (err && err.type === 'entity.parse.failed') return new AppError(400, 'BAD_JSON', 'Request body is not valid JSON.');
    return null;
}

function notFoundHandler(req, res) {
    res.status(404).json({ data: null, error: { message: 'Route not found.', code: 'NOT_FOUND' } });
}

// Operational errors (4xx) are returned as-is; anything else is a
// programmer error: logged with context, never leaked to the client.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
    const known = toAppError(err);
    if (known) {
        return res.status(known.status).json({ data: null, error: { message: known.message, code: known.code } });
    }
    console.error('[' + req.id + '] ' + req.method + ' ' + req.originalUrl + ' user=' + (req.user ? req.user.username : '-'), err);
    res.status(500).json({ data: null, error: { message: 'Something went wrong on our side.', code: 'INTERNAL_ERROR' } });
}

module.exports = { errorHandler, notFoundHandler };
