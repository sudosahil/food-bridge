const User = require('../models/User');
const Listing = require('../models/Listing');
const Review = require('../models/Review');
const AppError = require('../utils/AppError');
const photoStorage = require('../utils/photoStorage');
const transactionService = require('./transactionService');

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Public supplier directory: only approved, active donors.
async function listDonors(search) {
    const filter = { role: 'donor', active: true, verificationStatus: 'approved' };
    if (search) filter.name = new RegExp(escapeRegex(search), 'i');
    return User.find(filter).sort({ name: 1 }).limit(50);
}

// Donors can always see their own profile, and admins any; everyone else
// only sees approved, active donors.
async function getDonor(viewer, username) {
    const donor = await User.findOne({ username, role: 'donor' });
    const isOwnerOrAdmin = viewer.role === 'admin' || viewer.username === username;
    if (!donor || (!isOwnerOrAdmin && (!donor.active || donor.verificationStatus !== 'approved'))) {
        throw new AppError(404, 'NOT_FOUND', 'Supplier not found.');
    }
    return donor;
}

async function updateProfile(user, input) {
    user.phone = input.phone;
    user.zoneId = input.zoneId;
    user.address = input.address;
    if (user.role === 'donor') user.description = input.description || '';
    await user.save();
    return user;
}

// ---------- admin ----------
async function listAllUsers() {
    return User.find().sort({ role: 1, name: 1 });
}

async function findManagedUser(id, actingAdmin) {
    const target = await User.findById(id);
    if (!target) throw new AppError(404, 'NOT_FOUND', 'User not found.');
    if (target.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Admin accounts cannot be modified here.');
    if (String(target._id) === String(actingAdmin._id)) throw new AppError(403, 'FORBIDDEN', 'You cannot modify your own account.');
    return target;
}

function recordUserEvent(type, admin, target, summary) {
    return transactionService.record({
        type: type,
        actorUsername: admin.username, actorName: admin.name, actorRole: admin.role,
        summary: summary,
        // the affected user sees it in their own transactions too
        alsoVisibleTo: [target.username]
    });
}

async function setActive(id, active, actingAdmin) {
    const target = await findManagedUser(id, actingAdmin);
    target.active = active;
    await target.save();
    await recordUserEvent(active ? 'user_reactivated' : 'user_suspended', actingAdmin, target,
        actingAdmin.name + (active ? ' reactivated ' : ' suspended ') + target.name);
    return target;
}

async function setVerification(id, status, actingAdmin) {
    const target = await findManagedUser(id, actingAdmin);
    target.verificationStatus = status;
    target.verifiedAt = status === 'approved' ? new Date() : undefined;
    await target.save();
    await recordUserEvent(status === 'approved' ? 'user_approved' : 'user_unapproved', actingAdmin, target,
        actingAdmin.name + (status === 'approved' ? ' approved ' : ' unapproved ') + target.name);
    return target;
}

// Everything the admin profile page shows about one donor or NGO.
async function getUserOverview(id) {
    const user = await User.findById(id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');

    let listings = [];
    let reviews = [];
    if (user.role === 'donor') {
        listings = await Listing.find({ donorUsername: user.username }).sort({ postedAt: -1 }).limit(200);
        reviews = await Review.find({ donorUsername: user.username }).sort({ createdAt: -1 }).limit(200);
    } else if (user.role === 'ngo') {
        listings = await Listing.find({ 'claims.ngoUsername': user.username }).sort({ postedAt: -1 }).limit(200);
        reviews = await Review.find({ ngoUsername: user.username }).sort({ createdAt: -1 }).limit(200);
    }
    const transactions = await transactionService.list({ role: 'admin' }, { limit: 50, username: user.username });
    return { user: user, listings: listings, reviews: reviews, transactions: transactions };
}

// Deleting a donor removes their listings (and photos) and the reviews
// about them. Deleting an NGO removes the reviews they wrote; their claims
// stay on the listings as history because donors still need that record.
async function deleteUser(id, actingAdmin) {
    const target = await findManagedUser(id, actingAdmin);

    if (target.role === 'donor') {
        const listings = await Listing.find({ donorUsername: target.username }).select('photoUrl');
        await Promise.all(listings.map(function (l) { return photoStorage.deletePhoto(l.photoUrl); }));
        await Listing.deleteMany({ donorUsername: target.username });
        await Review.deleteMany({ donorUsername: target.username });
    } else {
        await Review.deleteMany({ ngoUsername: target.username });
    }
    await target.deleteOne();
    // The activity log is an audit trail, so earlier entries are kept.
    await transactionService.record({
        type: 'user_deleted',
        actorUsername: actingAdmin.username, actorName: actingAdmin.name, actorRole: actingAdmin.role,
        summary: actingAdmin.name + ' deleted the ' + (target.role === 'ngo' ? 'NGO ' : 'donor ') + target.name
    });
}

module.exports = { listDonors, getDonor, updateProfile, listAllUsers, setActive, setVerification, getUserOverview, deleteUser };
