/*
 * Surplus Food Bridge - js/common.js
 *
 * Shared code used by every page: the "database" (localStorage), the
 * pickup zones used for the map, and small helper functions.
 *
 * There is still no real backend here. To keep things close to what the
 * course covers (AJAX + JSON + async data loading), every read/write to
 * localStorage is wrapped in a Promise with a small artificial delay, so
 * the rest of the app can use fetchListings().then(...) / await exactly
 * like it would with a real fetch() call to a server.
 */

// ---------- LOCALSTORAGE KEYS ----------
// Bumped to "v4" so everyone gets the expanded seed accounts/listings
// below instead of whatever was cached from an earlier version.
const USERS_KEY = 'sfb_v4_users';
const LISTINGS_KEY = 'sfb_v4_listings';
const REVIEWS_KEY = 'sfb_v4_reviews';
const SESSION_KEY = 'sfb_v4_currentUser';

// ---------- PICKUP ZONES (used for location dropdowns + filtering) ----------
// A real app would geocode a street address. For this lab project donors
// just pick the nearest zone from this fixed list instead.
const ZONES = [
    { id: 'downtown', name: 'Downtown' },
    { id: 'uptown', name: 'Uptown' },
    { id: 'westside', name: 'West Side' },
    { id: 'eastend', name: 'East End' },
    { id: 'northpark', name: 'North Park' },
    { id: 'southgate', name: 'South Gate' }
];

const UNITS = ['servings', 'kg', 'boxes', 'trays', 'liters', 'pieces'];

function getZoneById(zoneId) {
    return ZONES.find(function (z) { return z.id === zoneId; }) || null;
}

// ---------- LOW LEVEL STORAGE HELPERS ----------
function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        return fallback;
    }
}
function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

// Wraps a value in a Promise with a short delay, standing in for a
// real network request so the rest of the app can be written with
// async/await the same way it would talk to a server.
function simulateRequest(payload, delay) {
    return new Promise(function (resolve) {
        setTimeout(function () { resolve(payload); }, delay || 180);
    });
}

// ---------- SEED DATA (only runs the very first time the app loads) ----------
function seedData() {
    if (!localStorage.getItem(USERS_KEY)) {
        const defaultUsers = [
            {
                username: 'donor', password: '1234', role: 'donor', name: 'Downtown Bakery',
                zoneId: 'downtown', address: '5th Avenue, near Central Plaza', phone: '+1 555-0101',
                description: 'Neighborhood bakery donating end-of-day bread and pastries.'
            },
            {
                username: 'greenplate', password: '1234', role: 'donor', name: 'Green Plate Cafe',
                zoneId: 'westside', address: '12 Harbor Road', phone: '+1 555-0142',
                description: 'Cafe serving fresh, seasonal meals. Donates surplus every evening.'
            },
            {
                username: 'campuskitchen', password: '1234', role: 'donor', name: 'Campus Kitchen Co-op',
                zoneId: 'eastend', address: '200 University Walk', phone: '+1 555-0177',
                description: 'Student-run kitchen donating leftover meal-plan food after each service.'
            },
            {
                username: 'ngo', password: '1234', role: 'ngo', name: 'City Shelter',
                zoneId: 'downtown', address: '88 Community Lane', phone: '+1 555-0199'
            },
            {
                username: 'foodrescue', password: '1234', role: 'ngo', name: 'Food Rescue Network',
                zoneId: 'uptown', address: '45 Relief Avenue', phone: '+1 555-0212'
            },
            {
                username: 'hopekitchen', password: '1234', role: 'ngo', name: 'Hope Community Kitchen',
                zoneId: 'southgate', address: '9 Charity Row', phone: '+1 555-0233'
            }
        ];
        writeJson(USERS_KEY, defaultUsers);
    }

    if (!localStorage.getItem(LISTINGS_KEY)) {
        const now = Date.now();
        const hour = 60 * 60 * 1000;
        const defaultListings = [
            {
                id: 'seed-1',
                foodName: 'Assorted Pastries',
                totalQuantity: 15,
                unit: 'servings',
                claimedQuantity: 0,
                zoneId: 'downtown',
                addressDetail: 'Rear entrance, ask for the kitchen manager.',
                donorUsername: 'donor',
                donorName: 'Downtown Bakery',
                preparedAt: new Date(now - 2 * hour).toISOString(),
                bestBeforeAt: new Date(now + 3 * hour).toISOString(),
                status: 'available',
                claims: [],
                postedAt: new Date(now - 2 * hour).toISOString()
            },
            {
                id: 'seed-2',
                foodName: 'Roast Chicken Trays',
                totalQuantity: 10,
                unit: 'trays',
                claimedQuantity: 4,
                zoneId: 'downtown',
                addressDetail: 'Loading dock on 5th Avenue.',
                donorUsername: 'donor',
                donorName: 'Downtown Bakery',
                preparedAt: new Date(now - 5 * hour).toISOString(),
                bestBeforeAt: new Date(now + 1 * hour).toISOString(),
                status: 'partially_claimed',
                claims: [
                    { ngoUsername: 'ngo', ngoName: 'City Shelter', quantity: 4, claimedAt: new Date(now - 1 * hour).toISOString() }
                ],
                postedAt: new Date(now - 5 * hour).toISOString()
            },
            {
                id: 'seed-3',
                foodName: 'Vegetable Soup Batch',
                totalQuantity: 8,
                unit: 'liters',
                claimedQuantity: 8,
                zoneId: 'westside',
                addressDetail: 'Front counter, packed in sealed containers.',
                donorUsername: 'greenplate',
                donorName: 'Green Plate Cafe',
                preparedAt: new Date(now - 30 * hour).toISOString(),
                bestBeforeAt: new Date(now - 24 * hour).toISOString(),
                status: 'claimed',
                claims: [
                    { ngoUsername: 'ngo', ngoName: 'City Shelter', quantity: 8, claimedAt: new Date(now - 25 * hour).toISOString() }
                ],
                postedAt: new Date(now - 30 * hour).toISOString()
            },
            {
                id: 'seed-4',
                foodName: 'Leftover Sandwich Platter',
                totalQuantity: 6,
                unit: 'boxes',
                claimedQuantity: 0,
                zoneId: 'westside',
                addressDetail: 'Ask the counter staff for the donation box.',
                donorUsername: 'greenplate',
                donorName: 'Green Plate Cafe',
                preparedAt: new Date(now - 20 * hour).toISOString(),
                bestBeforeAt: new Date(now - 2 * hour).toISOString(),
                status: 'available',
                claims: [],
                postedAt: new Date(now - 20 * hour).toISOString()
            },
            {
                id: 'seed-5',
                foodName: 'Vegetable Biryani Packs',
                totalQuantity: 12,
                unit: 'boxes',
                claimedQuantity: 0,
                zoneId: 'uptown',
                addressDetail: 'Side door near the parking lot.',
                donorUsername: 'donor',
                donorName: 'Downtown Bakery',
                preparedAt: new Date(now - 1 * hour).toISOString(),
                bestBeforeAt: new Date(now + 4 * hour).toISOString(),
                status: 'available',
                claims: [],
                postedAt: new Date(now - 1 * hour).toISOString()
            },
            {
                id: 'seed-6',
                foodName: 'Fresh Fruit Basket',
                totalQuantity: 20,
                unit: 'kg',
                claimedQuantity: 5,
                zoneId: 'northpark',
                addressDetail: 'Reception desk, second floor.',
                donorUsername: 'campuskitchen',
                donorName: 'Campus Kitchen Co-op',
                preparedAt: new Date(now - 3 * hour).toISOString(),
                bestBeforeAt: new Date(now + 2 * hour).toISOString(),
                status: 'partially_claimed',
                claims: [
                    { ngoUsername: 'ngo', ngoName: 'City Shelter', quantity: 5, claimedAt: new Date(now - 30 * 60 * 1000).toISOString() }
                ],
                postedAt: new Date(now - 3 * hour).toISOString()
            },
            {
                id: 'seed-7',
                foodName: 'Bread Loaves',
                totalQuantity: 30,
                unit: 'pieces',
                claimedQuantity: 0,
                zoneId: 'eastend',
                addressDetail: 'Bakery counter, boxed and labeled.',
                donorUsername: 'campuskitchen',
                donorName: 'Campus Kitchen Co-op',
                preparedAt: new Date(now - 1 * hour).toISOString(),
                bestBeforeAt: new Date(now + 6 * hour).toISOString(),
                status: 'available',
                claims: [],
                postedAt: new Date(now - 1 * hour).toISOString()
            },
            {
                id: 'seed-8',
                foodName: 'Rice and Curry Meal Boxes',
                totalQuantity: 25,
                unit: 'boxes',
                claimedQuantity: 0,
                zoneId: 'southgate',
                addressDetail: 'Kitchen back exit, ring the bell.',
                donorUsername: 'greenplate',
                donorName: 'Green Plate Cafe',
                preparedAt: new Date(now - 4 * hour).toISOString(),
                bestBeforeAt: new Date(now + 1 * hour).toISOString(),
                status: 'available',
                claims: [],
                postedAt: new Date(now - 4 * hour).toISOString()
            },
            {
                id: 'seed-9',
                foodName: 'Milk Cartons',
                totalQuantity: 10,
                unit: 'liters',
                claimedQuantity: 10,
                zoneId: 'uptown',
                addressDetail: 'Cold storage room, ask for a staff escort.',
                donorUsername: 'donor',
                donorName: 'Downtown Bakery',
                preparedAt: new Date(now - 10 * hour).toISOString(),
                bestBeforeAt: new Date(now - 6 * hour).toISOString(),
                status: 'claimed',
                claims: [
                    { ngoUsername: 'ngo', ngoName: 'City Shelter', quantity: 10, claimedAt: new Date(now - 7 * hour).toISOString() }
                ],
                postedAt: new Date(now - 10 * hour).toISOString()
            },
            {
                id: 'seed-10',
                foodName: 'Pasta Salad Trays',
                totalQuantity: 5,
                unit: 'trays',
                claimedQuantity: 0,
                zoneId: 'westside',
                addressDetail: 'Ask for the evening shift manager.',
                donorUsername: 'greenplate',
                donorName: 'Green Plate Cafe',
                preparedAt: new Date(now - 30 * 60 * 1000).toISOString(),
                bestBeforeAt: new Date(now + 30 * 60 * 1000).toISOString(),
                status: 'available',
                claims: [],
                postedAt: new Date(now - 30 * 60 * 1000).toISOString()
            },
            {
                id: 'seed-11',
                foodName: 'Cinnamon Rolls',
                totalQuantity: 8,
                unit: 'boxes',
                claimedQuantity: 8,
                zoneId: 'downtown',
                addressDetail: 'Front counter, ask for the donation tray.',
                donorUsername: 'donor',
                donorName: 'Downtown Bakery',
                preparedAt: new Date(now - 12 * hour).toISOString(),
                bestBeforeAt: new Date(now - 9 * hour).toISOString(),
                status: 'claimed',
                claims: [
                    { ngoUsername: 'foodrescue', ngoName: 'Food Rescue Network', quantity: 8, claimedAt: new Date(now - 8 * hour).toISOString() }
                ],
                postedAt: new Date(now - 12 * hour).toISOString()
            },
            {
                id: 'seed-12',
                foodName: 'Grilled Veggie Wraps',
                totalQuantity: 15,
                unit: 'pieces',
                claimedQuantity: 15,
                zoneId: 'westside',
                addressDetail: 'Side entrance, packed in a cooler bag.',
                donorUsername: 'greenplate',
                donorName: 'Green Plate Cafe',
                preparedAt: new Date(now - 9 * hour).toISOString(),
                bestBeforeAt: new Date(now - 6 * hour).toISOString(),
                status: 'claimed',
                claims: [
                    { ngoUsername: 'hopekitchen', ngoName: 'Hope Community Kitchen', quantity: 15, claimedAt: new Date(now - 5 * hour).toISOString() }
                ],
                postedAt: new Date(now - 9 * hour).toISOString()
            },
            {
                id: 'seed-13',
                foodName: 'Lentil Soup Batch',
                totalQuantity: 12,
                unit: 'liters',
                claimedQuantity: 12,
                zoneId: 'eastend',
                addressDetail: 'Kitchen back door, sealed containers ready.',
                donorUsername: 'campuskitchen',
                donorName: 'Campus Kitchen Co-op',
                preparedAt: new Date(now - 7 * hour).toISOString(),
                bestBeforeAt: new Date(now - 4 * hour).toISOString(),
                status: 'claimed',
                claims: [
                    { ngoUsername: 'foodrescue', ngoName: 'Food Rescue Network', quantity: 12, claimedAt: new Date(now - 3 * hour).toISOString() }
                ],
                postedAt: new Date(now - 7 * hour).toISOString()
            },
            {
                id: 'seed-14',
                foodName: 'Granola Bar Packs',
                totalQuantity: 10,
                unit: 'boxes',
                claimedQuantity: 10,
                zoneId: 'downtown',
                addressDetail: 'Reception desk, boxed and labeled.',
                donorUsername: 'donor',
                donorName: 'Downtown Bakery',
                preparedAt: new Date(now - 6 * hour).toISOString(),
                bestBeforeAt: new Date(now - 3 * hour).toISOString(),
                status: 'claimed',
                claims: [
                    { ngoUsername: 'hopekitchen', ngoName: 'Hope Community Kitchen', quantity: 10, claimedAt: new Date(now - 2 * hour).toISOString() }
                ],
                postedAt: new Date(now - 6 * hour).toISOString()
            }
        ];
        writeJson(LISTINGS_KEY, defaultListings);
    }

    if (!localStorage.getItem(REVIEWS_KEY)) {
        const now = Date.now();
        const hour = 60 * 60 * 1000;
        const defaultReviews = [
            {
                id: 'review-1',
                donorUsername: 'donor',
                ngoUsername: 'ngo',
                ngoName: 'City Shelter',
                listingId: 'seed-2',
                rating: 5,
                comment: 'Excellent quality and always ready right on time.',
                createdAt: new Date(now - 1 * hour).toISOString()
            },
            {
                id: 'review-2',
                donorUsername: 'donor',
                ngoUsername: 'foodrescue',
                ngoName: 'Food Rescue Network',
                listingId: 'seed-11',
                rating: 4,
                comment: 'Good variety, pickup window could be a bit longer.',
                createdAt: new Date(now - 7 * hour).toISOString()
            },
            {
                id: 'review-3',
                donorUsername: 'donor',
                ngoUsername: 'hopekitchen',
                ngoName: 'Hope Community Kitchen',
                listingId: 'seed-14',
                rating: 5,
                comment: 'Always packaged well and easy to collect.',
                createdAt: new Date(now - 1.5 * hour).toISOString()
            },
            {
                id: 'review-4',
                donorUsername: 'greenplate',
                ngoUsername: 'ngo',
                ngoName: 'City Shelter',
                listingId: 'seed-3',
                rating: 4,
                comment: 'Tasty and generous portions, would love a bit more notice next time.',
                createdAt: new Date(now - 24 * hour).toISOString()
            },
            {
                id: 'review-5',
                donorUsername: 'greenplate',
                ngoUsername: 'hopekitchen',
                ngoName: 'Hope Community Kitchen',
                listingId: 'seed-12',
                rating: 5,
                comment: 'Fantastic partner, the food is always fresh.',
                createdAt: new Date(now - 4 * hour).toISOString()
            },
            {
                id: 'review-6',
                donorUsername: 'campuskitchen',
                ngoUsername: 'ngo',
                ngoName: 'City Shelter',
                listingId: 'seed-6',
                rating: 5,
                comment: 'Reliable donations every week, thank you.',
                createdAt: new Date(now - 0.5 * hour).toISOString()
            },
            {
                id: 'review-7',
                donorUsername: 'campuskitchen',
                ngoUsername: 'foodrescue',
                ngoName: 'Food Rescue Network',
                listingId: 'seed-13',
                rating: 4,
                comment: 'Great quantity, sometimes ready a little later than posted.',
                createdAt: new Date(now - 2.5 * hour).toISOString()
            }
        ];
        writeJson(REVIEWS_KEY, defaultReviews);
    }
}
seedData();

// ---------- SIMULATED AJAX DATA LAYER ----------
function fetchUsers() {
    return simulateRequest(readJson(USERS_KEY, []));
}
function saveUsers(users) {
    writeJson(USERS_KEY, users);
    return simulateRequest(users);
}
function fetchListings() {
    return simulateRequest(readJson(LISTINGS_KEY, []));
}
function saveListings(listings) {
    writeJson(LISTINGS_KEY, listings);
    return simulateRequest(listings);
}
function fetchReviews() {
    return simulateRequest(readJson(REVIEWS_KEY, []));
}
function saveReviews(reviews) {
    writeJson(REVIEWS_KEY, reviews);
    return simulateRequest(reviews);
}

// ---------- SESSION HELPERS (no need to fake a delay for this) ----------
function getCurrentUser() {
    return readJson(SESSION_KEY, null);
}
function setCurrentUser(user) {
    writeJson(SESSION_KEY, user);
}
function clearCurrentUser() {
    localStorage.removeItem(SESSION_KEY);
}

// ---------- GENERAL UTILITIES ----------
function populateSelect(id, items, valueFn, labelFn) {
    const select = document.getElementById(id);
    items.forEach(function (item) {
        const option = document.createElement('option');
        option.value = valueFn(item);
        option.textContent = labelFn(item);
        select.appendChild(option);
    });
}

function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 10000).toString(36);
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

function isExpired(listing) {
    return new Date(listing.bestBeforeAt).getTime() <= Date.now();
}

function remainingQuantity(listing) {
    return Math.max(0, listing.totalQuantity - listing.claimedQuantity);
}

// Freshness is always computed live from the timestamps, never stored,
// so it stays accurate without needing a background job.
function getFreshnessInfo(listing) {
    const now = Date.now();
    const prepared = new Date(listing.preparedAt).getTime();
    const bestBefore = new Date(listing.bestBeforeAt).getTime();
    const remaining = bestBefore - now;

    if (remaining <= 0) {
        return { label: 'Expired', cssClass: 'freshness-expired', remainingMs: 0 };
    }

    const totalWindow = bestBefore - prepared;
    const ratio = totalWindow > 0 ? remaining / totalWindow : 0;

    if (ratio > 0.5) {
        return { label: 'Fresh', cssClass: 'freshness-fresh', remainingMs: remaining };
    }
    return { label: 'Use Soon', cssClass: 'freshness-soon', remainingMs: remaining };
}

function formatCountdown(ms) {
    if (ms <= 0) return 'Pickup window closed';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return hours + 'h ' + minutes + 'm left for pickup';
    return minutes + 'm left for pickup';
}

// Single source of truth for which badges a listing shows. Freshness
// (time-based) and claim status (quantity-based) are separate facts, but
// "Available" + "Expired" together reads as a contradiction, so once a
// listing is expired we drop the "Available" wording entirely and only
// keep "Partially Claimed" if that is still useful context.
function getListingBadges(item) {
    const freshness = getFreshnessInfo(item);
    const badges = [];

    if (freshness.label === 'Expired') {
        badges.push({ label: 'Expired', cssClass: freshness.cssClass });
        if (item.status === 'partially_claimed') {
            badges.push({ label: 'Partially Claimed', cssClass: 'status-claimed' });
        } else if (item.status === 'claimed') {
            badges.push({ label: 'Fully Claimed', cssClass: 'status-claimed' });
        }
        return badges;
    }

    if (item.status === 'claimed') {
        badges.push({ label: 'Fully Claimed', cssClass: 'status-claimed' });
    } else if (item.status === 'partially_claimed') {
        badges.push({ label: 'Partially Claimed', cssClass: 'status-available' });
    } else if (item.status === 'available') {
        badges.push({ label: 'Available', cssClass: 'status-available' });
    }
    badges.push({ label: freshness.label, cssClass: freshness.cssClass });
    return badges;
}

function renderBadgesHtml(item) {
    return getListingBadges(item).map(function (b) {
        return '<span class="badge status-badge ' + b.cssClass + '">' + b.label + '</span>';
    }).join('');
}

// ---------- RATINGS ----------
function computeDonorRating(reviews, donorUsername) {
    const mine = reviews.filter(function (r) { return r.donorUsername === donorUsername; });
    if (mine.length === 0) return { avg: 0, count: 0 };
    const total = mine.reduce(function (sum, r) { return sum + r.rating; }, 0);
    return { avg: total / mine.length, count: mine.length };
}

// Renders a row of 5 stars (filled up to the rounded average) as an HTML string.
function renderStarsHtml(avg) {
    const rounded = Math.round(avg);
    let html = '<span class="star-rating" aria-label="' + avg.toFixed(1) + ' out of 5 stars">';
    for (let i = 1; i <= 5; i++) {
        html += '<span class="star ' + (i <= rounded ? 'star-filled' : 'star-empty') + '">&#9733;</span>';
    }
    html += '</span>';
    return html;
}

// ---------- DASHBOARD STATS ----------
function computeDonorStats(listings, donorUsername) {
    const mine = listings.filter(function (l) { return l.donorUsername === donorUsername; });
    const activeCount = mine.filter(function (l) { return l.status !== 'claimed'; }).length;
    const completedCount = mine.filter(function (l) { return l.status === 'claimed'; }).length;
    const totalRescued = mine.reduce(function (sum, l) { return sum + l.claimedQuantity; }, 0);
    const ngoSet = new Set();
    mine.forEach(function (l) {
        l.claims.forEach(function (c) { ngoSet.add(c.ngoUsername); });
    });
    return { totalPosted: mine.length, activeCount: activeCount, completedCount: completedCount, totalRescued: totalRescued, ngoServed: ngoSet.size };
}

function computeNgoStats(listings, ngoUsername) {
    const available = listings.filter(function (l) { return remainingQuantity(l) > 0 && !isExpired(l); }).length;
    let myClaimCount = 0;
    let myQuantity = 0;
    listings.forEach(function (l) {
        l.claims.forEach(function (c) {
            if (c.ngoUsername === ngoUsername) {
                myClaimCount++;
                myQuantity += c.quantity;
            }
        });
    });
    return { available: available, myClaimCount: myClaimCount, myQuantity: myQuantity };
}

// ---------- SHARED NAVBAR / AUTH GUARD ----------
// Sends the visitor back to the login page if nobody is logged in, or if
// the logged in user does not have the expected role for this page.
function requireLogin(expectedRole) {
    const user = getCurrentUser();
    if (!user || user.role !== expectedRole) {
        window.location.href = 'index.html';
        return null;
    }
    return user;
}

// Same as requireLogin, but for pages any logged-in role can view (like
// a supplier profile).
function requireAnyLogin() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return null;
    }
    return user;
}

function dashboardUrlForRole(role) {
    if (role === 'donor') return 'donor.html';
    if (role === 'ngo') return 'ngo.html';
    return 'index.html';
}

function setupNavbar(user, extraLinkHtml) {
    const welcomeText = document.getElementById('welcomeText');
    const logoutBtn = document.getElementById('logoutBtn');
    const navExtra = document.getElementById('navExtraLink');

    if (welcomeText) welcomeText.textContent = 'Welcome, ' + user.name;
    if (navExtra && extraLinkHtml) navExtra.innerHTML = extraLinkHtml;

    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            clearCurrentUser();
            window.location.href = 'index.html';
        });
    }
}

// ---------- CLAIMING (shared so ngo.js and supplier.js do not duplicate it) ----------
// Throws an Error with a user-friendly message on failure.
async function performClaim(listingId, qty, ngoUsername, ngoName) {
    if (!(qty > 0)) {
        throw new Error('Enter a quantity greater than zero.');
    }

    const listings = await fetchListings();
    const listing = listings.find(function (l) { return l.id === listingId; });
    if (!listing) {
        throw new Error('This listing no longer exists.');
    }
    if (listing.claims.some(function (c) { return c.ngoUsername === ngoUsername; })) {
        throw new Error('You already claimed part of this listing.');
    }

    const remaining = remainingQuantity(listing);
    if (qty > remaining) {
        throw new Error('You can only claim up to ' + remaining + ' ' + listing.unit + '.');
    }

    listing.claims.push({
        ngoUsername: ngoUsername,
        ngoName: ngoName,
        quantity: qty,
        claimedAt: new Date().toISOString()
    });
    listing.claimedQuantity += qty;
    listing.status = listing.claimedQuantity >= listing.totalQuantity ? 'claimed' : 'partially_claimed';

    await saveListings(listings);
    return listings;
}

// ---------- LISTING DETAIL MODAL ----------
// Shared "click a listing to see everything about it" popup used on
// donor.html, ngo.html and supplier.html. Each page passes in how it
// wants claiming handled (or leaves it out for a read-only view).
let listingDetailModalInstance = null;

function ensureListingDetailModal() {
    const modalEl = document.getElementById('listingDetailModal');
    if (!modalEl) return null;
    if (!listingDetailModalInstance) {
        listingDetailModalInstance = new bootstrap.Modal(modalEl);
    }
    return listingDetailModalInstance;
}

// options:
//   currentUsername - the viewer's username, used to grey out "already claimed"
//   onClaim(listingId, qty) - if provided, shows a claim form when claimable
//   claimHint - plain text shown instead of a claim form (e.g. "Claim this from the NGO Dashboard")
function openListingDetailModal(item, options) {
    const modalEl = document.getElementById('listingDetailModal');
    if (!modalEl) return;
    options = options || {};

    const zone = getZoneById(item.zoneId);
    const freshness = getFreshnessInfo(item);
    const remaining = remainingQuantity(item);
    const claimedPercent = Math.min(100, Math.round((item.claimedQuantity / item.totalQuantity) * 100));

    const claimsHtml = item.claims.length > 0
        ? '<ul class="listing-detail ps-3 mb-0">' + item.claims.map(function (c) {
            return '<li>' + escapeHtml(c.ngoName) + ' claimed ' + c.quantity + ' ' + escapeHtml(item.unit) + ' on ' + formatDateTime(c.claimedAt) + '</li>';
        }).join('') + '</ul>'
        : '<p class="listing-meta mb-0">No claims yet.</p>';

    let actionHtml = '';
    if (options.onClaim) {
        const alreadyClaimed = options.currentUsername && item.claims.some(function (c) { return c.ngoUsername === options.currentUsername; });
        if (alreadyClaimed) {
            actionHtml = '<p class="listing-meta mt-3 mb-0">You already claimed part of this listing.</p>';
        } else if (freshness.label === 'Expired' || remaining <= 0) {
            actionHtml = '<p class="listing-meta mt-3 mb-0">This listing can no longer be claimed.</p>';
        } else {
            actionHtml =
                '<div class="claim-form mt-3">' +
                    '<input type="number" id="modalClaimQty" class="form-control form-control-sm" min="0.1" max="' + remaining + '" step="any" value="' + remaining + '">' +
                    '<button type="button" class="btn btn-claim" id="modalClaimBtn">Claim</button>' +
                '</div>';
        }
    } else if (options.claimHint) {
        actionHtml = '<p class="listing-meta mt-3 mb-0">' + escapeHtml(options.claimHint) + '</p>';
    }

    modalEl.querySelector('.modal-title').textContent = item.foodName;
    modalEl.querySelector('.modal-body').innerHTML =
        '<div class="mb-2">' + renderBadgesHtml(item) + '</div>' +
        '<p class="listing-detail"><strong>Donor:</strong> <a href="supplier.html?donor=' + encodeURIComponent(item.donorUsername) + '" class="listing-donor-link">' + escapeHtml(item.donorName) + '</a></p>' +
        '<p class="listing-detail"><strong>Zone:</strong> ' + escapeHtml(zone ? zone.name : 'Unknown') + '</p>' +
        '<p class="listing-detail"><strong>Pickup Instructions:</strong> ' + escapeHtml(item.addressDetail) + '</p>' +
        '<p class="listing-detail"><strong>Prepared:</strong> ' + formatDateTime(item.preparedAt) + '</p>' +
        '<p class="listing-detail"><strong>Pickup By:</strong> ' + formatDateTime(item.bestBeforeAt) + '</p>' +
        '<p class="countdown-text">' + formatCountdown(freshness.remainingMs) + '</p>' +
        '<p class="listing-detail mt-3"><strong>Quantity:</strong> ' + item.claimedQuantity + ' / ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + ' claimed (' + remaining + ' remaining)</p>' +
        '<div class="inventory-progress"><div class="inventory-progress-fill" style="width:' + claimedPercent + '%"></div></div>' +
        '<p class="listing-detail mt-3 mb-1"><strong>Claim History:</strong></p>' +
        claimsHtml +
        actionHtml;

    if (options.onClaim) {
        const btn = modalEl.querySelector('#modalClaimBtn');
        if (btn) {
            btn.addEventListener('click', function () {
                const qty = parseFloat(document.getElementById('modalClaimQty').value);
                ensureListingDetailModal().hide();
                options.onClaim(item.id, qty);
            });
        }
    }

    ensureListingDetailModal().show();
}

// Wires up "click the card to see details" on a listing card, while
// letting clicks on links/buttons inside it (donor name, claim form,
// review button) behave normally instead of also opening the modal.
function makeCardClickable(col, item, options) {
    col.classList.add('listing-card-clickable');
    col.addEventListener('click', function (event) {
        if (event.target.closest('a, button, input')) return;
        openListingDetailModal(item, options);
    });
}
