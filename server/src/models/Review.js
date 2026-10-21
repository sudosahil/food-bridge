const mongoose = require('mongoose');
const { toJsonTransform } = require('../utils/toJsonTransform');

const reviewSchema = new mongoose.Schema({
    donorUsername: { type: String, required: true, index: true },
    ngoUsername: { type: String, required: true },
    ngoName: { type: String, required: true },
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true }
}, { timestamps: true, toJSON: { transform: toJsonTransform } });

// One review per NGO per listing, enforced by the database.
reviewSchema.index({ ngoUsername: 1, listingId: 1 }, { unique: true });
reviewSchema.index({ listingId: 1 });

// Frontend reads `createdAt`; the default timestamps option already provides it.
module.exports = mongoose.model('Review', reviewSchema);
