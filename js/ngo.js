/*
 * Surplus Food Bridge - js/ngo.js
 * Logic for ngo.html: filtered feed (list + map), partial claiming,
 * claim history, and the review modal.
 */

let currentUser = null;
let currentView = 'list';
let ngoMap = null;
let mapMarkers = [];
let reviewModalInstance = null;

document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'ngo') return;
    initNgoPage();
});

async function initNgoPage() {
    const user = requireLogin('ngo');
    if (!user) return;

    setupNavbar(user);
    currentUser = user;

    populateSelect('filterZone', ZONES, function (z) { return z.id; }, function (z) { return z.name; });
    wireViewToggle();
    wireStarPicker();
    wireFilters();
    wireSupplierSearch();
    document.getElementById('reviewForm').addEventListener('submit', handleReviewSubmit);

    await renderAll();

    setInterval(renderAll, 60000);
    window.addEventListener('storage', function (event) {
        if (event.key === LISTINGS_KEY || event.key === REVIEWS_KEY) renderAll();
    });
}

function wireFilters() {
    ['filterSearch', 'filterZone', 'filterFreshness'].forEach(function (id) {
        const el = document.getElementById(id);
        el.addEventListener('input', renderAll);
        el.addEventListener('change', renderAll);
    });
}

// ---------- SUPPLIER SEARCH ----------
// Separate from the food-listing search above: this looks up donor
// organizations directly, so an NGO can jump to a supplier's profile
// without needing to already know one of their current listings.
function wireSupplierSearch() {
    const input = document.getElementById('supplierSearchInput');
    input.addEventListener('input', async function () {
        const query = input.value.trim();
        const resultsBox = document.getElementById('supplierSearchResults');

        if (!query) {
            resultsBox.innerHTML = '';
            return;
        }

        const [users, reviews] = await Promise.all([fetchUsers(), fetchReviews()]);
        const donors = users.filter(function (u) { return u.role === 'donor'; });
        renderSupplierSearchResults(query, donors, reviews);
    });
}

function renderSupplierSearchResults(query, donors, reviews) {
    const resultsBox = document.getElementById('supplierSearchResults');
    const q = query.toLowerCase();
    const matches = donors.filter(function (d) { return d.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);

    if (matches.length === 0) {
        resultsBox.innerHTML = '<p class="empty-state mb-0">No suppliers match "' + escapeHtml(query) + '".</p>';
        return;
    }

    resultsBox.innerHTML = matches.map(function (d) {
        const zone = getZoneById(d.zoneId);
        const rating = computeDonorRating(reviews, d.username);
        const ratingHtml = rating.count > 0
            ? renderStarsHtml(rating.avg) + ' <span class="listing-meta">(' + rating.count + ')</span>'
            : '<span class="listing-meta">No reviews yet</span>';

        return '<a href="supplier.html?donor=' + encodeURIComponent(d.username) + '" class="supplier-result-row">' +
            '<span>' +
                '<span class="supplier-result-name">' + escapeHtml(d.name) + '</span>' +
                '<span class="listing-meta d-block">' + escapeHtml(zone ? zone.name : 'Unknown zone') + '</span>' +
            '</span>' +
            '<span>' + ratingHtml + '</span>' +
        '</a>';
    }).join('');
}

function wireViewToggle() {
    const listBtn = document.getElementById('listViewBtn');
    const mapBtn = document.getElementById('mapViewBtn');
    const grid = document.getElementById('ngoFeedGrid');
    const mapDiv = document.getElementById('ngoFeedMap');

    listBtn.addEventListener('click', function () {
        currentView = 'list';
        listBtn.className = 'btn btn-primary-dark';
        mapBtn.className = 'btn btn-outline-brown';
        grid.classList.remove('d-none');
        mapDiv.classList.add('d-none');
    });

    mapBtn.addEventListener('click', async function () {
        currentView = 'map';
        mapBtn.className = 'btn btn-primary-dark';
        listBtn.className = 'btn btn-outline-brown';
        grid.classList.add('d-none');
        mapDiv.classList.remove('d-none');
        ensureMapInitialized();
        const listings = await fetchListings();
        updateMapMarkers(applyFilters(listings));
        setTimeout(function () { ngoMap.invalidateSize(); }, 50);
    });
}

// ---------- MAIN RENDER PIPELINE ----------
async function renderAll() {
    const [listings, reviews] = await Promise.all([fetchListings(), fetchReviews()]);

    const stats = computeNgoStats(listings, currentUser.username);
    document.getElementById('statAvailable').textContent = stats.available;
    document.getElementById('statMyClaims').textContent = stats.myClaimCount;
    document.getElementById('statMyQuantity').textContent = stats.myQuantity;

    const filtered = applyFilters(listings);
    renderFeedGrid(filtered);
    if (currentView === 'map') updateMapMarkers(filtered);

    renderHistory(listings, reviews);
}

function applyFilters(listings) {
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();
    const zoneId = document.getElementById('filterZone').value;
    const freshnessFilter = document.getElementById('filterFreshness').value;

    return listings.filter(function (item) {
        if (remainingQuantity(item) <= 0) return false;
        if (search) {
            const haystack = (item.foodName + ' ' + item.donorName).toLowerCase();
            if (haystack.indexOf(search) === -1) return false;
        }
        if (zoneId && item.zoneId !== zoneId) return false;
        if (freshnessFilter && getFreshnessInfo(item).label !== freshnessFilter) return false;
        return true;
    }).sort(function (a, b) { return new Date(a.bestBeforeAt) - new Date(b.bestBeforeAt); });
}

// ---------- LIST VIEW ----------
function renderFeedGrid(listings) {
    const grid = document.getElementById('ngoFeedGrid');
    grid.innerHTML = '';
    if (listings.length === 0) {
        grid.innerHTML = '<p class="empty-state">No listings match your filters right now.</p>';
        return;
    }
    listings.forEach(function (item) {
        grid.appendChild(buildNgoFeedCard(item));
    });
}

function buildNgoFeedCard(item) {
    const zone = getZoneById(item.zoneId);
    const freshness = getFreshnessInfo(item);
    const remaining = remainingQuantity(item);
    const alreadyClaimed = item.claims.some(function (c) { return c.ngoUsername === currentUser.username; });

    const col = document.createElement('div');
    col.className = 'col-md-4 mb-4';
    col.id = 'listing-' + item.id;

    let actionHtml;
    if (alreadyClaimed) {
        actionHtml = '<p class="listing-meta mb-0">You already claimed part of this listing.</p>';
    } else if (freshness.label === 'Expired') {
        actionHtml = '<p class="listing-meta mb-0">This listing is past its pickup window.</p>';
    } else {
        actionHtml =
            '<div class="claim-form">' +
                '<input type="number" class="form-control form-control-sm claim-qty-input" min="0.1" max="' + remaining + '" step="any" value="' + remaining + '">' +
                '<button type="button" class="btn btn-claim claim-btn">Claim</button>' +
            '</div>';
    }

    col.innerHTML =
        '<div class="card listing-card h-100">' +
            '<div>' + renderBadgesHtml(item) + '</div>' +
            '<h5 class="listing-title">' + escapeHtml(item.foodName) + '</h5>' +
            '<p class="listing-detail"><a href="supplier.html?donor=' + encodeURIComponent(item.donorUsername) + '" class="listing-donor-link">' + escapeHtml(item.donorName) + '</a></p>' +
            '<p class="listing-detail"><strong>Remaining:</strong> ' + remaining + ' / ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + '</p>' +
            '<p class="listing-detail"><strong>Zone:</strong> ' + escapeHtml(zone ? zone.name : 'Unknown') + '</p>' +
            '<p class="listing-detail"><strong>Pickup:</strong> ' + escapeHtml(item.addressDetail) + '</p>' +
            '<p class="countdown-text" data-countdown="' + item.bestBeforeAt + '">' + formatCountdown(freshness.remainingMs) + '</p>' +
            actionHtml +
        '</div>';

    const claimBtn = col.querySelector('.claim-btn');
    if (claimBtn) {
        claimBtn.addEventListener('click', function () {
            const qty = parseFloat(col.querySelector('.claim-qty-input').value);
            claimListing(item.id, qty);
        });
    }

    makeCardClickable(col, item, { onClaim: claimListing, currentUsername: currentUser.username });
    return col;
}

// ---------- MAP VIEW ----------
function ensureMapInitialized() {
    if (ngoMap) return;
    ngoMap = L.map('ngoFeedMap').setView([19.076, 72.8777], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(ngoMap);
}

// Nudges a zone's shared coordinate by a small, repeatable amount per
// listing so pins in the same zone do not stack exactly on top of each other.
function jitterCoord(base, seedStr, magnitude) {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = (hash * 31 + seedStr.charCodeAt(i)) % 10000;
    }
    return base + ((hash / 10000) - 0.5) * magnitude;
}

function updateMapMarkers(listings) {
    ensureMapInitialized();
    mapMarkers.forEach(function (m) { ngoMap.removeLayer(m); });
    mapMarkers = [];

    listings.forEach(function (item) {
        const zone = getZoneById(item.zoneId);
        if (!zone) return;

        const lat = jitterCoord(zone.lat, item.id + 'lat', 0.01);
        const lng = jitterCoord(zone.lng, item.id + 'lng', 0.01);
        const freshness = getFreshnessInfo(item);
        const remaining = remainingQuantity(item);
        const alreadyClaimed = item.claims.some(function (c) { return c.ngoUsername === currentUser.username; });
        const popupId = 'popup-claim-' + item.id;

        const actionHtml = (alreadyClaimed || freshness.label === 'Expired')
            ? '<p class="listing-meta mb-0">' + (alreadyClaimed ? 'Already claimed by you.' : 'Pickup window closed.') + '</p>'
            : '<div class="claim-form" id="' + popupId + '">' +
                  '<input type="number" min="0.1" max="' + remaining + '" step="any" value="' + remaining + '" class="form-control form-control-sm">' +
                  '<button type="button" class="btn btn-claim btn-sm">Claim</button>' +
              '</div>';

        const marker = L.marker([lat, lng]).addTo(ngoMap);
        marker.bindPopup(
            '<div class="map-popup">' +
                '<h6>' + escapeHtml(item.foodName) + '</h6>' +
                '<p class="mb-1">' + escapeHtml(item.donorName) + ' &middot; ' + escapeHtml(zone.name) + '</p>' +
                renderBadgesHtml(item) +
                '<p class="mb-1 mt-2">Remaining: ' + remaining + ' ' + escapeHtml(item.unit) + '</p>' +
                actionHtml +
            '</div>'
        );

        marker.on('popupopen', function () {
            const container = document.getElementById(popupId);
            if (!container) return;
            container.querySelector('button').addEventListener('click', function () {
                const qty = parseFloat(container.querySelector('input').value);
                claimListing(item.id, qty);
            });
        });

        mapMarkers.push(marker);
    });

    if (mapMarkers.length > 0) {
        ngoMap.fitBounds(L.featureGroup(mapMarkers).getBounds().pad(0.3));
    }
}

// ---------- CLAIMING (with automatic inventory update) ----------
async function claimListing(listingId, qty) {
    try {
        await performClaim(listingId, qty, currentUser.username, currentUser.name);
        await renderAll();
    } catch (err) {
        alert(err.message);
    }
}

// ---------- CLAIM HISTORY + REVIEWS ----------
function renderHistory(listings, reviews) {
    const historyGrid = document.getElementById('ngoHistoryGrid');
    historyGrid.innerHTML = '';

    const entries = [];
    listings.forEach(function (listing) {
        listing.claims.forEach(function (claim) {
            if (claim.ngoUsername === currentUser.username) {
                entries.push({ listing: listing, claim: claim });
            }
        });
    });
    entries.sort(function (a, b) { return new Date(b.claim.claimedAt) - new Date(a.claim.claimedAt); });

    if (entries.length === 0) {
        historyGrid.innerHTML = '<p class="empty-state">You have not claimed any food yet.</p>';
        return;
    }

    entries.forEach(function (entry) {
        historyGrid.appendChild(buildHistoryCard(entry, reviews));
    });
}

function buildHistoryCard(entry, reviews) {
    const listing = entry.listing;
    const claim = entry.claim;
    const existingReview = reviews.find(function (r) {
        return r.ngoUsername === currentUser.username && r.listingId === listing.id;
    });

    const col = document.createElement('div');
    col.className = 'col-md-4 mb-4';

    const reviewHtml = existingReview
        ? '<div class="mt-2">' + renderStarsHtml(existingReview.rating) + '<p class="listing-meta mb-0">"' + escapeHtml(existingReview.comment) + '"</p></div>'
        : '<button type="button" class="btn btn-outline-brown btn-sm mt-2 review-btn">Leave Review</button>';

    col.innerHTML =
        '<div class="card listing-card listing-card-muted h-100">' +
            '<span class="badge status-badge status-received">Received</span>' +
            '<h5 class="listing-title">' + escapeHtml(listing.foodName) + '</h5>' +
            '<p class="listing-detail"><a href="supplier.html?donor=' + encodeURIComponent(listing.donorUsername) + '" class="listing-donor-link">' + escapeHtml(listing.donorName) + '</a></p>' +
            '<p class="listing-detail"><strong>Claimed:</strong> ' + claim.quantity + ' ' + escapeHtml(listing.unit) + '</p>' +
            '<p class="listing-meta">On ' + formatDateTime(claim.claimedAt) + '</p>' +
            reviewHtml +
        '</div>';

    const reviewBtn = col.querySelector('.review-btn');
    if (reviewBtn) {
        reviewBtn.addEventListener('click', function () { openReviewModal(listing); });
    }

    makeCardClickable(col, listing, { onClaim: claimListing, currentUsername: currentUser.username });
    return col;
}

function openReviewModal(listing) {
    document.getElementById('reviewDonorUsername').value = listing.donorUsername;
    document.getElementById('reviewListingId').value = listing.id;
    document.getElementById('reviewComment').value = '';
    setStarPicker(5);

    if (!reviewModalInstance) {
        reviewModalInstance = new bootstrap.Modal(document.getElementById('reviewModal'));
    }
    reviewModalInstance.show();
}

function wireStarPicker() {
    document.querySelectorAll('#reviewStarPicker .star').forEach(function (star) {
        star.addEventListener('click', function () {
            setStarPicker(parseInt(star.getAttribute('data-value'), 10));
        });
    });
}

function setStarPicker(value) {
    document.getElementById('reviewRatingValue').value = value;
    document.querySelectorAll('#reviewStarPicker .star').forEach(function (star) {
        const starValue = parseInt(star.getAttribute('data-value'), 10);
        star.classList.toggle('star-active', starValue <= value);
    });
}

async function handleReviewSubmit(event) {
    event.preventDefault();

    const donorUsername = document.getElementById('reviewDonorUsername').value;
    const listingId = document.getElementById('reviewListingId').value;
    const rating = parseInt(document.getElementById('reviewRatingValue').value, 10);
    const comment = document.getElementById('reviewComment').value.trim();

    if (!comment) {
        alert('Please write a short comment.');
        return;
    }

    const reviews = await fetchReviews();
    reviews.push({
        id: uid('review'),
        donorUsername: donorUsername,
        ngoUsername: currentUser.username,
        ngoName: currentUser.name,
        listingId: listingId,
        rating: rating,
        comment: comment,
        createdAt: new Date().toISOString()
    });
    await saveReviews(reviews);

    reviewModalInstance.hide();
    await renderAll();
}

// Lightweight tick that only touches the countdown text so cards do not
// need a full re-render every few seconds.
setInterval(function () {
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
        const remainingMs = new Date(el.getAttribute('data-countdown')).getTime() - Date.now();
        el.textContent = formatCountdown(remainingMs);
    });
}, 15000);
