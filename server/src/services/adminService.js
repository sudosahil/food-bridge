const User = require('../models/User');
const Listing = require('../models/Listing');
const Review = require('../models/Review');

async function getStats() {
    const now = new Date();
    const [users, listings, reviews, activeListings, rescued, pending] = await Promise.all([
        User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 }, suspended: { $sum: { $cond: ['$active', 0, 1] } } } }]),
        Listing.countDocuments(),
        Review.countDocuments(),
        Listing.countDocuments({ status: { $ne: 'claimed' }, bestBeforeAt: { $gt: now } }),
        Listing.aggregate([{ $group: { _id: null, total: { $sum: '$claimedQuantity' } } }]),
        User.countDocuments({ role: { $in: ['donor', 'ngo'] }, verificationStatus: 'pending' })
    ]);

    const byRole = { donor: 0, ngo: 0, admin: 0 };
    let suspended = 0;
    users.forEach(function (row) {
        byRole[row._id] = row.count;
        suspended += row.suspended;
    });

    return {
        donors: byRole.donor,
        ngos: byRole.ngo,
        admins: byRole.admin,
        suspendedUsers: suspended,
        pendingApprovals: pending,
        totalListings: listings,
        activeListings: activeListings,
        totalReviews: reviews,
        unitsRescued: rescued.length ? rescued[0].total : 0
    };
}

module.exports = { getStats };
