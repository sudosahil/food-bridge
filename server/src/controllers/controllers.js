// Thin request handlers: pull validated input off the request, call a
// service, wrap the result in the { data, error } envelope.
const authService = require('../services/authService');
const userService = require('../services/userService');
const listingService = require('../services/listingService');
const reviewService = require('../services/reviewService');
const adminService = require('../services/adminService');
const transactionService = require('../services/transactionService');
const { issueSessionCookie, clearSessionCookie } = require('../middleware/auth');

function send(res, data, status) {
    res.status(status || 200).json({ data: data, error: null });
}

// ---------- auth ----------
async function register(req, res) {
    const user = await authService.register(req.valid.body);
    send(res, user, 201);
}

async function login(req, res) {
    const user = await authService.login(req.valid.body.username, req.valid.body.password);
    issueSessionCookie(res, user);
    send(res, user);
}

function logout(_req, res) {
    clearSessionCookie(res);
    send(res, { loggedOut: true });
}

function me(req, res) {
    send(res, req.user);
}

// ---------- users ----------
async function listDonors(req, res) {
    send(res, await userService.listDonors(req.valid.query.search));
}

async function getDonor(req, res) {
    send(res, await userService.getDonor(req.user, req.params.username));
}

async function updateMyProfile(req, res) {
    send(res, await userService.updateProfile(req.user, req.valid.body));
}

// ---------- listings ----------
async function listListings(req, res) {
    send(res, await listingService.list(req.user, req.valid.query.donor));
}

async function getListing(req, res) {
    send(res, await listingService.getById(req.user, req.params.id));
}

async function updateListing(req, res) {
    send(res, await listingService.update(req.user, req.params.id, req.valid.body, req.file));
}

async function createListing(req, res) {
    send(res, await listingService.create(req.user, req.valid.body, req.file), 201);
}

async function claimListing(req, res) {
    send(res, await listingService.claim(req.user, req.params.id, req.valid.body.quantity));
}

async function deleteListing(req, res) {
    await listingService.remove(req.user, req.params.id);
    send(res, { deleted: true });
}

// ---------- reviews ----------
async function listReviews(_req, res) {
    send(res, await reviewService.list());
}

async function createReview(req, res) {
    send(res, await reviewService.create(req.user, req.valid.body), 201);
}

async function deleteReview(req, res) {
    await reviewService.remove(req.params.id);
    send(res, { deleted: true });
}

// ---------- admin ----------
async function adminStats(_req, res) {
    send(res, await adminService.getStats());
}

async function adminListUsers(_req, res) {
    send(res, await userService.listAllUsers());
}

async function adminSetActive(req, res) {
    send(res, await userService.setActive(req.params.id, req.valid.body.active, req.user));
}

async function adminSetVerification(req, res) {
    send(res, await userService.setVerification(req.params.id, req.valid.body.status, req.user));
}

async function adminUserOverview(req, res) {
    send(res, await userService.getUserOverview(req.params.id));
}

// ---------- transactions ----------
async function listTransactions(req, res) {
    send(res, await transactionService.list(req.user, req.valid.query));
}

function streamTransactions(req, res) {
    transactionService.openStream(req.user, req, res);
}

async function adminDeleteUser(req, res) {
    await userService.deleteUser(req.params.id, req.user);
    send(res, { deleted: true });
}

module.exports = {
    register, login, logout, me,
    listDonors, getDonor, updateMyProfile,
    listListings, getListing, createListing, updateListing, claimListing, deleteListing,
    listReviews, createReview, deleteReview,
    adminStats, adminListUsers, adminSetActive, adminSetVerification, adminUserOverview, adminDeleteUser,
    listTransactions, streamTransactions
};
