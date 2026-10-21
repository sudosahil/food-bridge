const mongoose = require('mongoose');
const config = require('../config');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Review = require('../models/Review');
const Transaction = require('../models/Transaction');
const { hashPassword } = require('../services/authService');

const HOUR = 60 * 60 * 1000;
const DEMO_PASSWORD = '1234';

const DEMO_USERS = [
    { username: 'donor', role: 'donor', name: 'Colaba Bakery', zoneId: 'colaba', address: 'Colaba Causeway, near Regal Cinema', phone: '9821000101', registrationNumber: 'REG-' + '0101', description: 'Neighborhood bakery donating end-of-day bread and pastries.' },
    { username: 'greenplate', role: 'donor', name: 'Green Plate Cafe', zoneId: 'bandra', address: 'Linking Road, Bandra West', phone: '9821000142', registrationNumber: 'REG-' + '0142', description: 'Cafe serving fresh, seasonal meals. Donates surplus every evening.' },
    { username: 'campuskitchen', role: 'donor', name: 'Campus Kitchen Co-op', zoneId: 'kurla', address: 'LBS Marg, near Kurla Station', phone: '9821000177', registrationNumber: 'REG-' + '0177', description: 'Student-run kitchen donating leftover meal-plan food after each service.' },
    { username: 'ngo', role: 'ngo', name: 'City Shelter', zoneId: 'colaba', address: 'Shahid Bhagat Singh Road, Colaba', phone: '9821000199', registrationNumber: 'REG-' + '0199' },
    { username: 'foodrescue', role: 'ngo', name: 'Food Rescue Network', zoneId: 'powai', address: 'Hiranandani Gardens, Powai', phone: '9821000212', registrationNumber: 'REG-' + '0212' },
    { username: 'hopekitchen', role: 'ngo', name: 'Hope Community Kitchen', zoneId: 'andheri', address: 'SV Road, Andheri West', phone: '9821000233', registrationNumber: 'REG-' + '0233' }
];

const DONOR_NAMES = { donor: 'Colaba Bakery', greenplate: 'Green Plate Cafe', campuskitchen: 'Campus Kitchen Co-op' };
const NGO_NAMES = { ngo: 'City Shelter', foodrescue: 'Food Rescue Network', hopekitchen: 'Hope Community Kitchen' };

// Times are given as hours before/after "now" so the demo always has a mix
// of fresh, use-soon and expired listings no matter when it is seeded.
// claims: [ngoUsername, quantity, hoursAgo]
const DEMO_LISTINGS = [
    { key: 'seed-1', foodName: 'Assorted Pastries', total: 15, unit: 'servings', zoneId: 'colaba', addr: 'Rear entrance, ask for the kitchen manager.', donor: 'donor', prepared: -2, bestBefore: 3, claims: [] },
    { key: 'seed-2', foodName: 'Roast Chicken Trays', total: 10, unit: 'trays', zoneId: 'colaba', addr: 'Loading dock near Colaba Causeway.', donor: 'donor', prepared: -5, bestBefore: 1, claims: [['ngo', 4, 1]] },
    { key: 'seed-3', foodName: 'Vegetable Soup Batch', total: 8, unit: 'liters', zoneId: 'bandra', addr: 'Front counter, packed in sealed containers.', donor: 'greenplate', prepared: -30, bestBefore: -24, claims: [['ngo', 8, 25]] },
    { key: 'seed-4', foodName: 'Leftover Sandwich Platter', total: 6, unit: 'boxes', zoneId: 'bandra', addr: 'Ask the counter staff for the donation box.', donor: 'greenplate', prepared: -20, bestBefore: -2, claims: [] },
    { key: 'seed-5', foodName: 'Vegetable Biryani Packs', total: 12, unit: 'boxes', zoneId: 'powai', addr: 'Side door near the parking lot.', donor: 'donor', prepared: -1, bestBefore: 4, claims: [] },
    { key: 'seed-6', foodName: 'Fresh Fruit Basket', total: 20, unit: 'kg', zoneId: 'borivali', addr: 'Reception desk, second floor.', donor: 'campuskitchen', prepared: -3, bestBefore: 2, claims: [['ngo', 5, 0.5]] },
    { key: 'seed-7', foodName: 'Bread Loaves', total: 30, unit: 'pieces', zoneId: 'kurla', addr: 'Bakery counter, boxed and labeled.', donor: 'campuskitchen', prepared: -1, bestBefore: 6, claims: [] },
    { key: 'seed-8', foodName: 'Rice and Curry Meal Boxes', total: 25, unit: 'boxes', zoneId: 'andheri', addr: 'Kitchen back exit, ring the bell.', donor: 'greenplate', prepared: -4, bestBefore: 1, claims: [] },
    { key: 'seed-9', foodName: 'Milk Cartons', total: 10, unit: 'liters', zoneId: 'powai', addr: 'Cold storage room, ask for a staff escort.', donor: 'donor', prepared: -10, bestBefore: -6, claims: [['ngo', 10, 7]] },
    { key: 'seed-10', foodName: 'Pasta Salad Trays', total: 5, unit: 'trays', zoneId: 'bandra', addr: 'Ask for the evening shift manager.', donor: 'greenplate', prepared: -0.5, bestBefore: 0.5, claims: [] },
    { key: 'seed-11', foodName: 'Cinnamon Rolls', total: 8, unit: 'boxes', zoneId: 'colaba', addr: 'Front counter, ask for the donation tray.', donor: 'donor', prepared: -12, bestBefore: -9, claims: [['foodrescue', 8, 8]] },
    { key: 'seed-12', foodName: 'Grilled Veggie Wraps', total: 15, unit: 'pieces', zoneId: 'bandra', addr: 'Side entrance, packed in a cooler bag.', donor: 'greenplate', prepared: -9, bestBefore: -6, claims: [['hopekitchen', 15, 5]] },
    { key: 'seed-13', foodName: 'Lentil Soup Batch', total: 12, unit: 'liters', zoneId: 'kurla', addr: 'Kitchen back door, sealed containers ready.', donor: 'campuskitchen', prepared: -7, bestBefore: -4, claims: [['foodrescue', 12, 3]] },
    { key: 'seed-14', foodName: 'Granola Bar Packs', total: 10, unit: 'boxes', zoneId: 'colaba', addr: 'Reception desk, boxed and labeled.', donor: 'donor', prepared: -6, bestBefore: -3, claims: [['hopekitchen', 10, 2]] }
];

// [listing key, ngoUsername, rating, comment, hoursAgo]
const DEMO_REVIEWS = [
    ['seed-2', 'ngo', 5, 'Excellent quality and always ready right on time.', 1],
    ['seed-11', 'foodrescue', 4, 'Good variety, pickup window could be a bit longer.', 7],
    ['seed-14', 'hopekitchen', 5, 'Always packaged well and easy to collect.', 1.5],
    ['seed-3', 'ngo', 4, 'Tasty and generous portions, would love a bit more notice next time.', 24],
    ['seed-12', 'hopekitchen', 5, 'Fantastic partner, the food is always fresh.', 4],
    ['seed-6', 'ngo', 5, 'Reliable donations every week, thank you.', 0.5],
    ['seed-13', 'foodrescue', 4, 'Great quantity, sometimes ready a little later than posted.', 2.5]
];

function ago(now, hours) {
    return new Date(now + hours * HOUR);
}

async function ensureAdmin() {
    const existing = await User.exists({ role: 'admin' });
    if (existing) return;
    await User.create({
        username: config.adminUsername,
        passwordHash: await hashPassword(config.adminPassword),
        role: 'admin',
        name: 'Site Admin',
        verificationStatus: 'approved'
    });
    console.log('Created admin account "' + config.adminUsername + '".');
}

async function seedDemoData() {
    const now = Date.now();
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await User.insertMany(DEMO_USERS.map(function (u) { return Object.assign({ passwordHash: passwordHash, verificationStatus: 'approved', verifiedAt: new Date() }, u); }));

    const ids = {};
    DEMO_LISTINGS.forEach(function (l) { ids[l.key] = new mongoose.Types.ObjectId(); });

    await Listing.insertMany(DEMO_LISTINGS.map(function (l) {
        const claimed = l.claims.reduce(function (sum, c) { return sum + c[1]; }, 0);
        const status = claimed >= l.total ? 'claimed' : (claimed > 0 ? 'partially_claimed' : 'available');
        return {
            _id: ids[l.key],
            foodName: l.foodName,
            totalQuantity: l.total,
            unit: l.unit,
            claimedQuantity: claimed,
            zoneId: l.zoneId,
            addressDetail: l.addr,
            donorUsername: l.donor,
            donorName: DONOR_NAMES[l.donor],
            preparedAt: ago(now, l.prepared),
            bestBeforeAt: ago(now, l.bestBefore),
            status: status,
            claims: l.claims.map(function (c) {
                return { ngoUsername: c[0], ngoName: NGO_NAMES[c[0]], quantity: c[1], claimedAt: ago(now, -c[2]) };
            }),
            postedAt: ago(now, l.prepared)
        };
    }));

    const donorByKey = {};
    DEMO_LISTINGS.forEach(function (l) { donorByKey[l.key] = l.donor; });
    await Review.insertMany(DEMO_REVIEWS.map(function (r) {
        return {
            donorUsername: donorByKey[r[0]],
            ngoUsername: r[1],
            ngoName: NGO_NAMES[r[1]],
            listingId: ids[r[0]],
            rating: r[2],
            comment: r[3],
            createdAt: ago(now, -r[4])
        };
    }));

    // Matching activity history, so the transactions page has something to
    // show from the start (posts, claims and reviews with their real times).
    const transactions = [];
    DEMO_LISTINGS.forEach(function (l) {
        const donorName = DONOR_NAMES[l.donor];
        transactions.push({
            type: 'listing_posted', actorUsername: l.donor, actorName: donorName, actorRole: 'donor',
            listingId: ids[l.key], listingName: l.foodName, donorUsername: l.donor, quantity: l.total, unit: l.unit,
            summary: donorName + ' posted ' + l.total + ' ' + l.unit + ' of ' + l.foodName,
            participants: [l.donor], createdAt: ago(now, l.prepared)
        });
        l.claims.forEach(function (c) {
            transactions.push({
                type: 'claim', actorUsername: c[0], actorName: NGO_NAMES[c[0]], actorRole: 'ngo',
                listingId: ids[l.key], listingName: l.foodName, donorUsername: l.donor, ngoUsername: c[0], quantity: c[1], unit: l.unit,
                summary: NGO_NAMES[c[0]] + ' claimed ' + c[1] + ' ' + l.unit + ' of ' + l.foodName + ' from ' + donorName,
                participants: [c[0], l.donor], createdAt: ago(now, -c[2])
            });
        });
    });
    DEMO_REVIEWS.forEach(function (r) {
        const listing = DEMO_LISTINGS.find(function (l) { return l.key === r[0]; });
        transactions.push({
            type: 'review_posted', actorUsername: r[1], actorName: NGO_NAMES[r[1]], actorRole: 'ngo',
            listingId: ids[r[0]], listingName: listing.foodName, donorUsername: listing.donor, ngoUsername: r[1],
            summary: NGO_NAMES[r[1]] + ' rated ' + DONOR_NAMES[listing.donor] + ' ' + r[2] + '/5 for ' + listing.foodName,
            participants: [r[1], listing.donor], createdAt: ago(now, -r[4])
        });
    });
    await Transaction.insertMany(transactions);
}

// Called on every server start. Seeds demo data only into an empty
// database, and makes sure an admin account always exists.
async function ensureSeeded() {
    // Accounts created before verification existed are treated as approved.
    await User.updateMany({ verificationStatus: { $exists: false } }, { $set: { verificationStatus: 'approved', verifiedAt: new Date() } });

    const hasUsers = await User.exists({ role: { $ne: 'admin' } });
    if (!hasUsers) {
        await seedDemoData();
        console.log('Seeded demo accounts, listings and reviews.');
    }
    await ensureAdmin();
}

// Wipes everything and seeds again (used by `npm run seed`).
async function resetAndSeed() {
    await Promise.all([User.deleteMany({}), Listing.deleteMany({}), Review.deleteMany({}), Transaction.deleteMany({})]);
    await seedDemoData();
    await ensureAdmin();
}

module.exports = { ensureSeeded, resetAndSeed };
