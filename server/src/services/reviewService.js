const mongoose = require('mongoose');
const Review = require('../models/Review');
const Listing = require('../models/Listing');
const AppError = require('../utils/AppError');
const transactionService = require('./transactionService');

const MAX_REVIEWS = 1000;

async function list() {
    return Review.find().sort({ createdAt: -1 }).limit(MAX_REVIEWS);
}

// donorUsername is taken from the listing, never from the client, and the
// reviewer must actually have claimed from that listing.
async function create(ngo, input) {
    if (!mongoose.isValidObjectId(input.listingId)) throw new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
    const listing = await Listing.findById(input.listingId);
    if (!listing) throw new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
    if (!listing.claims.some(function (c) { return c.ngoUsername === ngo.username; })) {
        throw new AppError(403, 'FORBIDDEN', 'You can only review listings you claimed.');
    }

    let review;
    try {
        review = await Review.create({
            donorUsername: listing.donorUsername,
            ngoUsername: ngo.username,
            ngoName: ngo.name,
            listingId: listing._id,
            rating: input.rating,
            comment: input.comment
        });
    } catch (err) {
        if (err.code === 11000) throw new AppError(409, 'DUPLICATE', 'You already reviewed this listing.');
        throw err;
    }

    await transactionService.record({
        type: 'review_posted',
        actorUsername: ngo.username, actorName: ngo.name, actorRole: ngo.role,
        listingId: listing._id, listingName: listing.foodName,
        donorUsername: listing.donorUsername, ngoUsername: ngo.username,
        summary: ngo.name + ' rated ' + listing.donorName + ' ' + review.rating + '/5 for ' + listing.foodName
    });
    return review;
}

async function remove(reviewId) {
    if (!mongoose.isValidObjectId(reviewId)) throw new AppError(404, 'NOT_FOUND', 'Review not found.');
    const deleted = await Review.findByIdAndDelete(reviewId);
    if (!deleted) throw new AppError(404, 'NOT_FOUND', 'Review not found.');
}

module.exports = { list, create, remove };
