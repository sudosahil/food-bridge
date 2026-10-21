const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const AppError = require('../utils/AppError');

const COOKIE_NAME = 'sfb_token';

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.isProduction,
        maxAge: config.cookieMaxAgeMs
    };
}

function issueSessionCookie(res, user) {
    const token = jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

// Loads the user from the DB on every request (rather than trusting the
// token's claims) so a suspension or role change takes effect immediately.
async function authenticate(req, _res, next) {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in.');

    let payload;
    try {
        payload = jwt.verify(token, config.jwtSecret);
    } catch (err) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please log in again.');
    }

    const user = await User.findById(payload.sub);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in.');
    if (!user.active) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended.');

    req.user = user;
    next();
}

function authorize(...roles) {
    return function (req, _res, next) {
        if (!roles.includes(req.user.role)) {
            throw new AppError(403, 'FORBIDDEN', 'You do not have access to this action.');
        }
        next();
    };
}

// Donors and NGOs must be approved by an admin before they can act (post,
// edit, claim, review). Admins are always allowed. Browsing stays open.
function requireApproved(req, _res, next) {
    if (req.user.role !== 'admin' && req.user.verificationStatus !== 'approved') {
        const message = req.user.verificationStatus === 'unapproved'
            ? 'Your account is not approved. Please contact the admin.'
            : 'Your account is waiting for admin approval. You can browse, but you cannot post or claim yet.';
        throw new AppError(403, 'NOT_APPROVED', message);
    }
    next();
}

module.exports = { authenticate, authorize, requireApproved, issueSessionCookie, clearSessionCookie };
