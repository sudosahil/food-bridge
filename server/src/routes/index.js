const express = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/controllers');
const schemas = require('../schemas');
const config = require('../config');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requireApproved } = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');

const router = express.Router();

// Brute-force guard for the endpoints that take credentials.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: function () { return config.env === 'test'; },
    message: { data: null, error: { message: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' } }
});

// ---------- auth ----------
router.post('/auth/register', authLimiter, validate(schemas.register), c.register);
router.post('/auth/login', authLimiter, validate(schemas.login), c.login);
router.post('/auth/logout', c.logout);
router.get('/auth/me', authenticate, c.me);

// Everything below requires a logged-in, active user.
router.use(authenticate);

// ---------- users ----------
router.get('/users/donors', validate(schemas.donorSearchQuery, 'query'), c.listDonors);
router.get('/users/donors/:username', c.getDonor);
router.patch('/users/me', authorize('donor', 'ngo'), validate(schemas.updateProfile), c.updateMyProfile);

// ---------- listings ----------
router.get('/listings', validate(schemas.listListingsQuery, 'query'), c.listListings);
router.post('/listings', authorize('donor'), requireApproved, uploadPhoto, validate(schemas.createListing), c.createListing);
router.get('/listings/:id', c.getListing);
router.patch('/listings/:id', authorize('donor', 'admin'), requireApproved, uploadPhoto, validate(schemas.updateListing), c.updateListing);
router.post('/listings/:id/claim', authorize('ngo'), requireApproved, validate(schemas.claim), c.claimListing);
router.delete('/listings/:id', authorize('donor', 'admin'), c.deleteListing);

// ---------- reviews ----------
router.get('/reviews', c.listReviews);
router.post('/reviews', authorize('ngo'), requireApproved, validate(schemas.createReview), c.createReview);
router.delete('/reviews/:id', authorize('admin'), c.deleteReview);

// ---------- admin ----------
router.get('/admin/stats', authorize('admin'), c.adminStats);
router.get('/admin/users', authorize('admin'), c.adminListUsers);
router.get('/admin/users/:id/overview', authorize('admin'), c.adminUserOverview);
router.patch('/admin/users/:id', authorize('admin'), validate(schemas.setActive), c.adminSetActive);
router.patch('/admin/users/:id/verification', authorize('admin'), validate(schemas.setVerification), c.adminSetVerification);
router.delete('/admin/users/:id', authorize('admin'), c.adminDeleteUser);

// ---------- transactions (admins see all, others only their own) ----------
router.get('/transactions', validate(schemas.transactionsQuery, 'query'), c.listTransactions);
router.get('/transactions/stream', c.streamTransactions);

module.exports = router;
