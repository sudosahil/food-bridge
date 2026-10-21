/*
 * Surplus Food Bridge - js/common.js
 *
 * Shared code used by every page: the API client for the Node/MongoDB
 * backend (server/), the pickup zones, and small helper functions.
 *
 * The pages must be opened through the server (npm start, then
 * http://localhost:3000) so /api requests and the login cookie work.
 */

// ---------- PICKUP ZONES (used for location dropdowns + filtering) ----------
// A real app would geocode a street address. For this lab project donors
// just pick the nearest Mumbai area from this fixed list instead.
// Keep in sync with ZONE_IDS in server/src/constants.js.
const ZONES = [
    { id: 'colaba', name: 'Colaba' },
    { id: 'bandra', name: 'Bandra' },
    { id: 'andheri', name: 'Andheri' },
    { id: 'kurla', name: 'Kurla' },
    { id: 'borivali', name: 'Borivali' },
    { id: 'powai', name: 'Powai' }
];

const UNITS = ['servings', 'kg', 'boxes', 'trays', 'liters', 'pieces'];

function getZoneById(zoneId) {
    return ZONES.find(function (z) { return z.id === zoneId; }) || null;
}

// ---------- PHONE VALIDATION ----------
// Indian mobile numbers: exactly 10 digits, no country code, spaces, or
// dashes. Shared by the register form (login.js) and the profile edit
// form (supplier.js) so both enforce the same rule.
function isValidPhone(phone) {
    return /^[0-9]{10}$/.test(phone);
}

// Locks a phone <input> down to digits only, max 10 characters:
// - keydown blocks any non-digit key before it even appears (letters,
//   symbols, spaces), and blocks further digits once 10 are already in.
// - input still strips/truncates as a fallback for paste/autofill/etc.
// - live validity feedback + a native "Please match the requested format"
//   style message if the user tries to submit with fewer than 10 digits.
function wireDigitsOnlyPhoneInput(inputEl) {
    const allowedControlKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

    inputEl.addEventListener('keydown', function (event) {
        if (allowedControlKeys.includes(event.key) || event.ctrlKey || event.metaKey) return;

        const isDigit = /^[0-9]$/.test(event.key);
        const atMaxLength = inputEl.value.length >= 10 && inputEl.selectionStart === inputEl.selectionEnd;

        if (!isDigit || atMaxLength) {
            event.preventDefault();
        }
    });

    inputEl.addEventListener('input', function () {
        inputEl.value = inputEl.value.replace(/\D/g, '').slice(0, 10);
        inputEl.setCustomValidity(isValidPhone(inputEl.value) ? '' : 'Enter exactly 10 digits.');
    });
}

// ---------- API CLIENT ----------
// Talks to the Node/Express backend (server/). The login session is an
// httpOnly cookie set by the server, so there is no token handling here:
// same-origin fetch() sends it automatically.
async function apiRequest(method, path, body) {
    const options = { method: method, credentials: 'same-origin', headers: {} };
    if (body instanceof FormData) {
        options.body = body;
    } else if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch('/api' + path, options);
    } catch (networkError) {
        throw new Error('Cannot reach the server. Is it running?');
    }

    const payload = await response.json().catch(function () { return null; });
    if (!response.ok) {
        const error = new Error(payload && payload.error ? payload.error.message : 'Request failed.');
        error.status = response.status;
        error.code = payload && payload.error ? payload.error.code : 'UNKNOWN';
        throw error;
    }
    return payload.data;
}

// ---------- AUTH / SESSION ----------
// Resolves to the logged-in user, or null if nobody is logged in.
async function fetchCurrentUser() {
    try {
        return await apiRequest('GET', '/auth/me');
    } catch (err) {
        if (err.status === 401 || err.status === 403) return null;
        throw err;
    }
}
function loginRequest(username, password) {
    return apiRequest('POST', '/auth/login', { username: username, password: password });
}
function registerRequest(fields) {
    return apiRequest('POST', '/auth/register', fields);
}
function logoutRequest() {
    return apiRequest('POST', '/auth/logout');
}

// ---------- DATA ----------
function fetchListings() {
    return apiRequest('GET', '/listings');
}
function fetchReviews() {
    return apiRequest('GET', '/reviews');
}
function fetchDonors(search) {
    return apiRequest('GET', '/users/donors' + (search ? '?search=' + encodeURIComponent(search) : ''));
}
function fetchDonor(username) {
    return apiRequest('GET', '/users/donors/' + encodeURIComponent(username));
}
function updateMyProfile(fields) {
    return apiRequest('PATCH', '/users/me', fields);
}
// formData carries the listing fields plus an optional "photo" file.
function createListingRequest(formData) {
    return apiRequest('POST', '/listings', formData);
}
function createReviewRequest(fields) {
    return apiRequest('POST', '/reviews', fields);
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
// The server is the source of truth for who is logged in (httpOnly cookie),
// so these are async. Callers: `const user = await requireLogin('ngo');`
async function requireLogin(expectedRole) {
    const user = await fetchCurrentUser();
    if (!user || user.role !== expectedRole) {
        window.location.href = 'index.html';
        return null;
    }
    return user;
}

// Same as requireLogin, but for pages any logged-in role can view (like
// a supplier profile).
async function requireAnyLogin() {
    const user = await fetchCurrentUser();
    if (!user) {
        window.location.href = 'index.html';
        return null;
    }
    return user;
}

function dashboardUrlForRole(role) {
    if (role === 'donor') return 'donor.html';
    if (role === 'ngo') return 'ngo.html';
    if (role === 'admin') return 'admin.html';
    return 'index.html';
}

function setupNavbar(user, extraLinkHtml) {
    const welcomeText = document.getElementById('welcomeText');
    const logoutBtn = document.getElementById('logoutBtn');
    const navExtra = document.getElementById('navExtraLink');

    if (welcomeText) welcomeText.textContent = 'Welcome, ' + user.name;
    // Every signed-in page links to the transactions page next to its own extra link.
    if (navExtra) navExtra.innerHTML = (extraLinkHtml || '') + '<a href="transactions.html">Transactions</a>';

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function () {
            try { await logoutRequest(); } finally { window.location.href = 'index.html'; }
        });
    }
    renderVerificationBanner(user);
}

// Donors and NGOs that an admin has not approved yet can browse but not act,
// so say so at the top of every page instead of failing silently on click.
function renderVerificationBanner(user) {
    if (user.role === 'admin' || user.verificationStatus === 'approved') return;
    const container = document.querySelector('body > .container');
    if (!container) return;

    const banner = document.createElement('div');
    banner.className = 'verify-banner verify-' + user.verificationStatus;
    banner.setAttribute('role', 'status');
    banner.textContent = user.verificationStatus === 'unapproved'
        ? 'Your account is not approved. You can browse, but you cannot ' + (user.role === 'donor' ? 'post food' : 'claim food') + '. Please contact the admin.'
        : 'Your account is waiting for admin approval. You can browse now and ' + (user.role === 'donor' ? 'post food' : 'claim food') + ' once it is approved.';
    container.insertBefore(banner, container.firstChild);
}

// ---------- LISTING + TRANSACTION API ----------
function fetchListing(id) {
    return apiRequest('GET', '/listings/' + encodeURIComponent(id));
}
// formData carries the listing fields, an optional "photo" file, and removePhoto.
function updateListingRequest(id, formData) {
    return apiRequest('PATCH', '/listings/' + encodeURIComponent(id), formData);
}
function fetchTransactions(params) {
    const query = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') query.set(key, params[key]);
    });
    const qs = query.toString();
    return apiRequest('GET', '/transactions' + (qs ? '?' + qs : ''));
}

// Chip text and colour for each kind of transaction.
const TRANSACTION_TYPES = {
    claim: { label: 'Claim', cssClass: 'tx-claim' },
    listing_posted: { label: 'Posted', cssClass: 'tx-posted' },
    listing_edited: { label: 'Edited', cssClass: 'tx-edited' },
    listing_removed: { label: 'Removed', cssClass: 'tx-removed' },
    review_posted: { label: 'Review', cssClass: 'tx-review' },
    user_registered: { label: 'Registered', cssClass: 'tx-account' },
    user_approved: { label: 'Approved', cssClass: 'tx-claim' },
    user_unapproved: { label: 'Unapproved', cssClass: 'tx-removed' },
    user_suspended: { label: 'Suspended', cssClass: 'tx-removed' },
    user_reactivated: { label: 'Reactivated', cssClass: 'tx-claim' },
    user_deleted: { label: 'Deleted', cssClass: 'tx-removed' }
};

function renderTransactionTypeHtml(type) {
    const info = TRANSACTION_TYPES[type] || { label: type, cssClass: 'tx-account' };
    return '<span class="badge status-badge ' + info.cssClass + '">' + escapeHtml(info.label) + '</span>';
}

// "just now", "5 min ago", "3 h ago", else the date. Pair it with the
// exact time in a title attribute so nothing is lost.
function formatRelativeTime(isoString, nowMs) {
    const diff = (nowMs === undefined ? Date.now() : nowMs) - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' h ago';
    return formatDate(isoString);
}

// Labels for the verification chips used on admin pages.
function renderVerificationChipHtml(status) {
    const map = {
        approved: { label: 'Approved', cssClass: 'status-active-user' },
        pending: { label: 'Pending', cssClass: 'freshness-soon' },
        unapproved: { label: 'Unapproved', cssClass: 'status-suspended' }
    };
    const info = map[status] || map.pending;
    return '<span class="badge status-badge ' + info.cssClass + '">' + info.label + '</span>';
}

// ---------- CLAIMING (shared so ngo.js and supplier.js do not duplicate it) ----------
// The server does the real work atomically: if two NGOs claim at the same
// moment, only the ones that still fit succeed and the rest get a 409 with
// a plain-language reason. Throws an Error with that message on failure.
async function performClaim(listingId, qty) {
    if (!(qty > 0)) {
        throw new Error('Enter a quantity greater than zero.');
    }
    return apiRequest('POST', '/listings/' + encodeURIComponent(listingId) + '/claim', { quantity: qty });
}

// Small auto-dismissing message in the corner. type: 'success' | 'error'.
function showToast(message, type) {
    let stack = document.getElementById('toastStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toastStack';
        stack.className = 'toast-stack';
        stack.setAttribute('role', 'status');
        stack.setAttribute('aria-live', 'polite');
        document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = 'app-toast app-toast-' + (type || 'success');
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(function () {
        toast.classList.add('app-toast-out');
        setTimeout(function () { toast.remove(); }, 300);
    }, 4000);
}

// Disables a button while an async action runs so a double-click can only
// ever send one request (the server also guards against duplicates).
async function runOnce(button, action) {
    if (button) {
        if (button.disabled) return;
        button.disabled = true;
    }
    try {
        return await action();
    } finally {
        if (button) button.disabled = false;
    }
}

// ---------- SHELF-LIFE GAUGE ----------
// Share of the prepared-to-pickup-deadline window that is still left (0..1).
function shelfLifeRatio(item) {
    const prepared = new Date(item.preparedAt).getTime();
    const bestBefore = new Date(item.bestBeforeAt).getTime();
    const window = bestBefore - prepared;
    if (window <= 0) return 0;
    return Math.min(1, Math.max(0, (bestBefore - Date.now()) / window));
}

// A bar that shrinks as the pickup deadline approaches, coloured by the
// same Fresh / Use Soon / Expired state the badges use.
function renderShelfLifeHtml(item) {
    const freshness = getFreshnessInfo(item);
    const colorClass = freshness.label === 'Fresh' ? 'shelf-fresh' : (freshness.label === 'Use Soon' ? 'shelf-soon' : 'shelf-expired');
    const percent = Math.round(shelfLifeRatio(item) * 100);
    return '<div class="shelf-life" role="img" aria-label="' + percent + '% of shelf life left">' +
        '<div class="shelf-life-fill ' + colorClass + '" style="width:' + percent + '%"></div></div>';
}

// ---------- LISTING PHOTO ----------
// Photos are optional, so every card shows either the image or a neutral
// placeholder to keep the grid aligned.
function renderListingPhotoHtml(item, extraClass) {
    const cls = 'listing-photo' + (extraClass ? ' ' + extraClass : '');
    if (item.photoUrl) {
        return '<img class="' + cls + '" src="' + escapeHtml(item.photoUrl) + '" alt="Photo of ' + escapeHtml(item.foodName) + '" loading="lazy">';
    }
    return '<div class="' + cls + ' listing-photo-empty" aria-hidden="true"><span>No photo</span></div>';
}

// Photo with the status chips laid over its top edge.
function renderListingMediaHtml(item) {
    return '<div class="listing-media">' + renderListingPhotoHtml(item) +
        '<div class="listing-chips">' + renderBadgesHtml(item) + '</div></div>';
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
        '<div class="listing-media">' + renderListingPhotoHtml(item, 'listing-photo-large') +
            '<div class="listing-chips">' + renderBadgesHtml(item) + '</div></div>' +
        renderShelfLifeHtml(item) +
        '<p class="listing-detail"><strong>Donor:</strong> <a href="supplier.html?donor=' + encodeURIComponent(item.donorUsername) + '" class="listing-donor-link">' + escapeHtml(item.donorName) + '</a></p>' +
        '<p class="listing-detail"><strong>Zone:</strong> ' + escapeHtml(zone ? zone.name : 'Unknown') + '</p>' +
        '<p class="listing-detail"><strong>Pickup Instructions:</strong> ' + escapeHtml(item.addressDetail) + '</p>' +
        '<p class="listing-detail"><strong>Prepared:</strong> ' + formatDateTime(item.preparedAt) + '</p>' +
        '<p class="listing-detail"><strong>Pickup By:</strong> ' + formatDateTime(item.bestBeforeAt) + '</p>' +
        '<p class="countdown-text mb-0">' + formatCountdown(freshness.remainingMs) + '</p>' +
        '<p class="listing-detail mt-3"><strong>Quantity:</strong> ' + item.claimedQuantity + ' / ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + ' claimed (' + remaining + ' remaining)</p>' +
        '<div class="inventory-progress"><div class="inventory-progress-fill" style="width:' + claimedPercent + '%"></div></div>' +
        '<p class="listing-detail mt-3 mb-1"><strong>Claim History:</strong></p>' +
        claimsHtml +
        actionHtml +
        '<div class="mt-3"><a class="btn btn-outline-brown btn-sm" href="listing.html?id=' + encodeURIComponent(item.id) + '">Open full page</a></div>';

    if (options.onClaim) {
        const btn = modalEl.querySelector('#modalClaimBtn');
        if (btn) {
            btn.addEventListener('click', function () {
                const qty = parseFloat(document.getElementById('modalClaimQty').value);
                runOnce(btn, async function () {
                    await options.onClaim(item.id, qty);
                    ensureListingDetailModal().hide();
                });
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
