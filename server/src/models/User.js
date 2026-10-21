const mongoose = require('mongoose');
const { ROLES, ZONE_IDS, VERIFICATION_STATUSES } = require('../constants');
const { toJsonTransform } = require('../utils/toJsonTransform');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    name: { type: String, required: true, trim: true },
    zoneId: { type: String, enum: ZONE_IDS },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    description: { type: String, trim: true, default: '' },
    // NGO registration number or the donor's food licence, checked by an admin.
    registrationNumber: { type: String, trim: true },
    // New donors/NGOs start as pending; they cannot post, claim or review
    // until an admin approves them.
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'pending', index: true },
    verifiedAt: { type: Date },
    // Admins can suspend an account; suspended users cannot log in or use the API.
    active: { type: Boolean, default: true }
}, { timestamps: true, toJSON: { transform: toJsonTransform } });

module.exports = mongoose.model('User', userSchema);
