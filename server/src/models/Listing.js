const mongoose = require('mongoose');
const { UNITS, ZONE_IDS } = require('../constants');
const { toJsonTransform } = require('../utils/toJsonTransform');

const claimSchema = new mongoose.Schema({
    ngoUsername: { type: String, required: true },
    ngoName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    claimedAt: { type: Date, required: true }
}, { _id: false });

const listingSchema = new mongoose.Schema({
    foodName: { type: String, required: true, trim: true },
    totalQuantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: UNITS, required: true },
    claimedQuantity: { type: Number, default: 0, min: 0 },
    zoneId: { type: String, enum: ZONE_IDS, required: true, index: true },
    addressDetail: { type: String, required: true, trim: true },
    donorUsername: { type: String, required: true, index: true },
    donorName: { type: String, required: true },
    preparedAt: { type: Date, required: true },
    bestBeforeAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['available', 'partially_claimed', 'claimed'], default: 'available', index: true },
    claims: { type: [claimSchema], default: [] },
    photoUrl: { type: String, default: null },
    postedAt: { type: Date, default: Date.now }
}, { timestamps: true, toJSON: { transform: toJsonTransform } });

module.exports = mongoose.model('Listing', listingSchema);
