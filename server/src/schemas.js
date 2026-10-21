const { z } = require('zod');
const { ZONE_IDS, UNITS, SELF_REGISTER_ROLES } = require('./constants');

const phone = z.string().regex(/^[0-9]{10}$/, 'Enter exactly 10 digits.');
const zoneId = z.enum(ZONE_IDS);
const quantity = z.coerce.number().positive('Quantity must be greater than zero.').max(100000)
    .transform(function (n) { return Math.round(n * 100) / 100; })
    .refine(function (n) { return n > 0; }, 'Quantity must be greater than zero.');

const registrationNumber = z.string().trim().regex(/^[A-Za-z0-9/ ().,-]{5,30}$/, 'Enter a valid registration number (5 to 30 letters, digits, spaces or / ( ) . , -).');

const register = z.object({
    role: z.enum(SELF_REGISTER_ROLES),
    name: z.string().trim().min(1).max(100),
    username: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_.-]+$/, 'Use letters, numbers, dot, dash or underscore only.'),
    password: z.string().min(6, 'Password must be at least 6 characters.').max(100),
    zoneId,
    phone,
    address: z.string().trim().min(1).max(200),
    registrationNumber,
    description: z.string().trim().max(500).optional()
});

const login = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1)
});

const updateProfile = z.object({
    phone,
    zoneId,
    address: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).optional()
});

// Multipart fields arrive as strings, so numbers/dates are coerced.
const listingFields = z.object({
    foodName: z.string().trim().min(1).max(100),
    totalQuantity: quantity,
    unit: z.enum(UNITS),
    zoneId,
    addressDetail: z.string().trim().min(1).max(200),
    preparedAt: z.coerce.date(),
    bestBeforeAt: z.coerce.date()
});

function withDeadlineRules(schema) {
    return schema
        .refine(function (v) { return v.bestBeforeAt > v.preparedAt; }, { message: 'Pickup deadline must be after the prepared time.', path: ['bestBeforeAt'] })
        .refine(function (v) { return v.bestBeforeAt > new Date(); }, { message: 'Pickup deadline must be in the future.', path: ['bestBeforeAt'] });
}

const createListing = withDeadlineRules(listingFields);
const updateListing = withDeadlineRules(listingFields.extend({ removePhoto: z.enum(['true', 'false']).optional() }));

const claim = z.object({ quantity });

const createReview = z.object({
    listingId: z.string().min(1),
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(500)
});

const listListingsQuery = z.object({
    donor: z.string().trim().min(1).optional()
});

const donorSearchQuery = z.object({
    search: z.string().trim().max(100).optional()
});

const setActive = z.object({ active: z.boolean() });

const setVerification = z.object({ status: z.enum(['approved', 'unapproved']) });

const transactionsQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.coerce.date().optional(),
    listingId: z.string().trim().min(1).optional()
});

module.exports = { register, login, updateProfile, createListing, updateListing, claim, createReview, listListingsQuery, donorSearchQuery, setActive, setVerification, transactionsQuery };
