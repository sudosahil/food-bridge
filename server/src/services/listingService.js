const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Review = require('../models/Review');
const AppError = require('../utils/AppError');
const photoStorage = require('../utils/photoStorage');
const transactionService = require('./transactionService');

const MAX_LISTINGS = 500;

function assertValidId(id) {
    if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// Donors that suspended or unapproved accounts must not show up publicly.
async function hiddenDonorUsernames() {
    return User.find({ role: 'donor', $or: [{ active: false }, { verificationStatus: { $ne: 'approved' } }] }).distinct('username');
}

async function list(viewer, donorUsername) {
    const filter = {};
    if (viewer.role !== 'admin') {
        const hidden = (await hiddenDonorUsernames()).filter(function (u) { return u !== viewer.username; });
        if (hidden.length) filter.donorUsername = { $nin: hidden };
    }
    if (donorUsername) {
        filter.donorUsername = Object.assign({}, filter.donorUsername, { $eq: donorUsername });
    }
    return Listing.find(filter).sort({ postedAt: -1 }).limit(MAX_LISTINGS);
}

async function getById(viewer, listingId) {
    assertValidId(listingId);
    const listing = await Listing.findById(listingId);
    if (!listing) throw new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
    if (viewer.role !== 'admin' && listing.donorUsername !== viewer.username) {
        const hidden = await hiddenDonorUsernames();
        if (hidden.includes(listing.donorUsername)) throw new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
    }
    return listing;
}

async function create(donor, input, file) {
    // Validate the file before touching the disk; write it only once the
    // rest of the request is known to be good, and undo it if the insert fails.
    const extension = file ? photoStorage.assertValidPhoto(file) : null;
    const photoUrl = file ? await photoStorage.savePhoto(file, extension) : null;

    let listing;
    try {
        listing = await Listing.create({
            foodName: input.foodName,
            totalQuantity: input.totalQuantity,
            unit: input.unit,
            zoneId: input.zoneId,
            addressDetail: input.addressDetail,
            donorUsername: donor.username,
            donorName: donor.name,
            preparedAt: input.preparedAt,
            bestBeforeAt: input.bestBeforeAt,
            photoUrl: photoUrl
        });
    } catch (err) {
        await photoStorage.deletePhoto(photoUrl);
        throw err;
    }

    await transactionService.record({
        type: 'listing_posted',
        actorUsername: donor.username, actorName: donor.name, actorRole: donor.role,
        listingId: listing._id, listingName: listing.foodName, donorUsername: donor.username,
        quantity: listing.totalQuantity, unit: listing.unit,
        summary: donor.name + ' posted ' + listing.totalQuantity + ' ' + listing.unit + ' of ' + listing.foodName
    });
    return listing;
}

// ---------- editing ----------
const EDIT_LABELS = {
    foodName: 'name', totalQuantity: 'quantity', unit: 'unit', zoneId: 'zone',
    addressDetail: 'pickup instructions', preparedAt: 'prepared time', bestBeforeAt: 'pickup deadline'
};

// Times are compared to the minute: the browser's datetime picker has no
// seconds, so an untouched time would otherwise look edited.
function comparable(value) {
    return value instanceof Date ? Math.floor(value.getTime() / 60000) : value;
}

function changedFields(existing, input) {
    return Object.keys(EDIT_LABELS).filter(function (key) {
        return comparable(existing[key]) !== comparable(input[key]);
    }).map(function (key) { return EDIT_LABELS[key]; });
}

// $literal stops MongoDB reading a value such as "$100 thali" as a field path.
function lit(value) {
    return { $literal: value };
}

// Like claiming, editing is one atomic update. The filter re-checks the
// rules at write time, so an edit racing a claim can never leave the total
// below what has already been claimed, and status is recomputed in the
// same step.
async function update(actor, listingId, input, file) {
    assertValidId(listingId);
    const existing = await Listing.findById(listingId);
    if (!existing || (actor.role !== 'admin' && existing.donorUsername !== actor.username)) {
        throw new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
    }
    if (existing.status === 'claimed') {
        throw new AppError(409, 'FULLY_CLAIMED', 'A fully claimed listing can no longer be edited.');
    }

    const unitChanged = input.unit !== existing.unit;
    if (unitChanged && existing.claims.length > 0) {
        throw new AppError(409, 'UNIT_LOCKED', 'The unit cannot change once an NGO has claimed from this listing.');
    }
    if (input.totalQuantity < existing.claimedQuantity) {
        throw new AppError(409, 'BELOW_CLAIMED', existing.claimedQuantity + ' ' + existing.unit + ' are already claimed, so the total cannot be lower than that.');
    }

    const wantsRemove = input.removePhoto === 'true';
    const extension = file ? photoStorage.assertValidPhoto(file) : null;
    const newPhotoUrl = file ? await photoStorage.savePhoto(file, extension) : null;

    const set = {
        foodName: lit(input.foodName),
        totalQuantity: input.totalQuantity,
        unit: lit(input.unit),
        zoneId: lit(input.zoneId),
        addressDetail: lit(input.addressDetail),
        preparedAt: input.preparedAt,
        bestBeforeAt: input.bestBeforeAt
    };
    if (file) set.photoUrl = lit(newPhotoUrl);
    else if (wantsRemove) set.photoUrl = null;

    const filter = {
        _id: existing._id,
        status: { $ne: 'claimed' },
        $expr: { $lte: ['$claimedQuantity', input.totalQuantity] }
    };
    if (unitChanged) filter['claims.0'] = { $exists: false };

    let updated;
    try {
        updated = await Listing.findOneAndUpdate(
            filter,
            [
                { $set: set },
                { $set: { status: { $cond: [{ $gte: ['$claimedQuantity', '$totalQuantity'] }, 'claimed', { $cond: [{ $gt: ['$claimedQuantity', 0] }, 'partially_claimed', 'available'] }] } } }
            ],
            { returnDocument: 'after', timestamps: false, updatePipeline: true }
        );
    } catch (err) {
        await photoStorage.deletePhoto(newPhotoUrl);
        throw err;
    }

    if (!updated) {
        await photoStorage.deletePhoto(newPhotoUrl);
        throw new AppError(409, 'CONFLICT', 'This listing was just claimed or changed by someone else. Reload and try again.');
    }

    if (file || wantsRemove) await photoStorage.deletePhoto(existing.photoUrl);

    const changes = changedFields(existing, input);
    if (file) changes.push('photo');
    else if (wantsRemove && existing.photoUrl) changes.push('photo removed');
    if (changes.length > 0) {
        await transactionService.record({
            type: 'listing_edited',
            actorUsername: actor.username, actorName: actor.name, actorRole: actor.role,
            listingId: updated._id, listingName: updated.foodName, donorUsername: updated.donorUsername,
            summary: actor.name + ' edited ' + updated.foodName + ' (' + changes.join(', ') + ')',
            // every NGO that already claimed should see that the listing changed
            alsoVisibleTo: updated.claims.map(function (c) { return c.ngoUsername; })
        });
    }
    return updated;
}

// ---------- claiming ----------
// Claiming is one atomic findOneAndUpdate: MongoDB evaluates the filter
// and applies the update on a single document with no gap in between.
// If two NGOs click "Claim" in the same instant, the database serialises
// them: the second one's filter is evaluated against the already-updated
// document, so it can never push the total past what was posted, and the
// same NGO can never be recorded twice. No read-then-write race exists.
async function claim(ngo, listingId, quantity) {
    assertValidId(listingId);
    const now = new Date();

    const updated = await Listing.findOneAndUpdate(
        {
            _id: listingId,
            status: { $ne: 'claimed' },
            bestBeforeAt: { $gt: now },
            'claims.ngoUsername': { $ne: ngo.username },
            $expr: { $gte: [{ $round: [{ $subtract: ['$totalQuantity', '$claimedQuantity'] }, 2] }, quantity] }
        },
        [
            {
                $set: {
                    claimedQuantity: { $round: [{ $add: ['$claimedQuantity', quantity] }, 2] },
                    claims: {
                        $concatArrays: ['$claims', [{ ngoUsername: lit(ngo.username), ngoName: lit(ngo.name), quantity: quantity, claimedAt: now }]]
                    }
                }
            },
            {
                $set: {
                    status: { $cond: [{ $gte: ['$claimedQuantity', '$totalQuantity'] }, 'claimed', 'partially_claimed'] }
                }
            }
        ],
        { returnDocument: 'after', timestamps: false, updatePipeline: true }
    );

    if (!updated) throw await explainClaimFailure(ngo, listingId, now);

    await transactionService.record({
        type: 'claim',
        actorUsername: ngo.username, actorName: ngo.name, actorRole: ngo.role,
        listingId: updated._id, listingName: updated.foodName,
        donorUsername: updated.donorUsername, ngoUsername: ngo.username,
        quantity: quantity, unit: updated.unit,
        summary: ngo.name + ' claimed ' + quantity + ' ' + updated.unit + ' of ' + updated.foodName + ' from ' + updated.donorName
    });
    return updated;
}

// Runs only after a claim was rejected, to tell the user which rule they hit.
async function explainClaimFailure(ngo, listingId, now) {
    const listing = await Listing.findById(listingId);
    if (!listing) return new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
    if (listing.claims.some(function (c) { return c.ngoUsername === ngo.username; })) {
        return new AppError(409, 'ALREADY_CLAIMED', 'You already claimed part of this listing.');
    }
    if (listing.bestBeforeAt <= now) {
        return new AppError(409, 'EXPIRED', 'This listing is past its pickup window.');
    }
    const remaining = round2(listing.totalQuantity - listing.claimedQuantity);
    if (remaining <= 0) {
        return new AppError(409, 'FULLY_CLAIMED', 'Someone else just claimed the last of this listing.');
    }
    return new AppError(409, 'INSUFFICIENT_QUANTITY', 'Only ' + remaining + ' ' + listing.unit + ' left. Try a smaller amount.');
}

// Admins can remove anything. A donor can remove only their own listing, and
// only while nobody has claimed from it: the filter is checked at delete time,
// so a claim racing the delete either lands first (delete refused) or loses.
async function remove(actor, listingId) {
    assertValidId(listingId);
    const filter = { _id: listingId };
    if (actor.role !== 'admin') {
        filter.donorUsername = actor.username;
        filter['claims.0'] = { $exists: false };
    }
    const listing = await Listing.findOneAndDelete(filter);
    if (!listing) {
        const existing = await Listing.findById(listingId);
        if (!existing || existing.donorUsername !== actor.username) {
            throw new AppError(404, 'NOT_FOUND', 'This listing no longer exists.');
        }
        throw new AppError(409, 'HAS_CLAIMS', 'An NGO has already claimed from this listing, so it can no longer be deleted.');
    }
    await Review.deleteMany({ listingId: listing._id });
    await photoStorage.deletePhoto(listing.photoUrl);

    await transactionService.record({
        type: 'listing_removed',
        actorUsername: actor.username, actorName: actor.name, actorRole: actor.role,
        listingId: listing._id, listingName: listing.foodName, donorUsername: listing.donorUsername,
        summary: actor.name + ' removed ' + listing.foodName + ' posted by ' + listing.donorName,
        alsoVisibleTo: listing.claims.map(function (c) { return c.ngoUsername; })
    });
}

module.exports = { list, getById, create, update, claim, remove };
