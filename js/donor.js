/*
 * Surplus Food Bridge - js/donor.js
 * Logic for donor.html: posting food, and rendering the active /
 * history grids for the logged in donor.
 */

document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'donor') return;
    initDonorPage();
});

async function initDonorPage() {
    const user = requireLogin('donor');
    if (!user) return;

    setupNavbar(user, '<a href="supplier.html?donor=' + encodeURIComponent(user.username) + '">My Profile</a>');
    populateSelect('foodUnit', UNITS, function (u) { return u; }, function (u) { return u; });
    populateSelect('foodZone', ZONES, function (z) { return z.id; }, function (z) { return z.name; });

    const foodForm = document.getElementById('foodForm');
    foodForm.addEventListener('submit', function (event) {
        event.preventDefault();
        handlePostFood(user, foodForm);
    });

    await renderDonorDashboard(user);

    // Keep the numbers and cards live: a slow full refresh (inventory /
    // freshness can change), no need to poll faster than this.
    setInterval(function () { renderDonorDashboard(user); }, 60000);

    // If an NGO claims something in another tab, refresh right away
    window.addEventListener('storage', function (event) {
        if (event.key === LISTINGS_KEY) renderDonorDashboard(user);
    });
}

async function handlePostFood(user, foodForm) {
    const errorBox = document.getElementById('foodFormError');
    errorBox.classList.add('d-none');

    const foodName = document.getElementById('foodName').value.trim();
    const quantity = parseFloat(document.getElementById('foodQuantity').value);
    const unit = document.getElementById('foodUnit').value;
    const zoneId = document.getElementById('foodZone').value;
    const addressDetail = document.getElementById('foodAddressDetail').value.trim();
    const preparedAtValue = document.getElementById('foodPreparedAt').value;
    const bestBeforeValue = document.getElementById('foodBestBefore').value;

    if (!foodName || !unit || !zoneId || !addressDetail || !preparedAtValue || !bestBeforeValue) {
        return showFormError(errorBox, 'Please fill in every field.');
    }
    if (!(quantity > 0)) {
        return showFormError(errorBox, 'Quantity must be greater than zero.');
    }

    const preparedAt = new Date(preparedAtValue);
    const bestBefore = new Date(bestBeforeValue);

    if (bestBefore.getTime() <= preparedAt.getTime()) {
        return showFormError(errorBox, 'Pickup deadline must be after the prepared time.');
    }
    if (bestBefore.getTime() <= Date.now()) {
        return showFormError(errorBox, 'Pickup deadline must be in the future.');
    }

    const listings = await fetchListings();
    listings.push({
        id: uid('listing'),
        foodName: foodName,
        totalQuantity: quantity,
        unit: unit,
        claimedQuantity: 0,
        zoneId: zoneId,
        addressDetail: addressDetail,
        donorUsername: user.username,
        donorName: user.name,
        preparedAt: preparedAt.toISOString(),
        bestBeforeAt: bestBefore.toISOString(),
        status: 'available',
        claims: [],
        postedAt: new Date().toISOString()
    });
    await saveListings(listings);

    foodForm.reset();
    await renderDonorDashboard(user);
}

function showFormError(errorBox, message) {
    errorBox.textContent = message;
    errorBox.classList.remove('d-none');
}

async function renderDonorDashboard(user) {
    const activeGrid = document.getElementById('donorActiveGrid');
    const historyGrid = document.getElementById('donorHistoryGrid');

    const listings = await fetchListings();
    const myListings = listings.filter(function (l) { return l.donorUsername === user.username; });
    const activeListings = myListings.filter(function (l) { return l.status !== 'claimed'; })
        .sort(function (a, b) { return new Date(a.bestBeforeAt) - new Date(b.bestBeforeAt); });
    const pastListings = myListings.filter(function (l) { return l.status === 'claimed'; })
        .sort(function (a, b) { return new Date(b.bestBeforeAt) - new Date(a.bestBeforeAt); });

    const stats = computeDonorStats(listings, user.username);
    document.getElementById('statTotalPosted').textContent = stats.totalPosted;
    document.getElementById('statActive').textContent = stats.activeCount;
    document.getElementById('statRescued').textContent = stats.totalRescued;
    document.getElementById('statNgoServed').textContent = stats.ngoServed;

    activeGrid.innerHTML = '';
    if (activeListings.length === 0) {
        activeGrid.innerHTML = '<p class="empty-state">You have no active donations right now. Post a new item above.</p>';
    } else {
        activeListings.forEach(function (item) {
            activeGrid.appendChild(buildDonorActiveCard(item));
        });
    }

    historyGrid.innerHTML = '';
    if (pastListings.length === 0) {
        historyGrid.innerHTML = '<p class="empty-state">No donations have been fully claimed yet.</p>';
    } else {
        pastListings.forEach(function (item) {
            historyGrid.appendChild(buildDonorHistoryCard(item));
        });
    }
}

function buildDonorActiveCard(item) {
    const zone = getZoneById(item.zoneId);
    const freshness = getFreshnessInfo(item);
    const remaining = remainingQuantity(item);
    const claimedPercent = Math.min(100, Math.round((item.claimedQuantity / item.totalQuantity) * 100));

    const col = document.createElement('div');
    col.className = 'col-xl-3 col-lg-4 col-md-6 mb-3';
    col.innerHTML =
        '<div class="card listing-card h-100">' +
            '<div>' + renderBadgesHtml(item) + '</div>' +
            '<h5 class="listing-title">' + escapeHtml(item.foodName) + '</h5>' +
            '<p class="listing-detail"><strong>Remaining:</strong> ' + remaining + ' / ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + '</p>' +
            '<div class="inventory-progress"><div class="inventory-progress-fill" style="width:' + claimedPercent + '%"></div></div>' +
            '<p class="listing-detail"><strong>Zone:</strong> ' + escapeHtml(zone ? zone.name : 'Unknown') + '</p>' +
            '<p class="countdown-text" data-countdown="' + item.bestBeforeAt + '">' + formatCountdown(freshness.remainingMs) + '</p>' +
            '<p class="listing-meta">Prepared ' + formatDateTime(item.preparedAt) + '</p>' +
        '</div>';
    makeCardClickable(col, item, {});
    return col;
}

function buildDonorHistoryCard(item) {
    const claimsHtml = item.claims.map(function (c) {
        return '<li>' + escapeHtml(c.ngoName) + ' &mdash; ' + c.quantity + ' ' + escapeHtml(item.unit) + ' on ' + formatDate(c.claimedAt) + '</li>';
    }).join('');

    const col = document.createElement('div');
    col.className = 'col-xl-3 col-lg-4 col-md-6 mb-3';
    col.innerHTML =
        '<div class="card listing-card listing-card-muted h-100">' +
            '<span class="badge status-badge status-claimed">Fully Claimed</span>' +
            '<h5 class="listing-title">' + escapeHtml(item.foodName) + '</h5>' +
            '<p class="listing-detail"><strong>Total:</strong> ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + '</p>' +
            '<hr>' +
            '<p class="listing-detail claimed-by mb-1"><strong>Claimed by:</strong></p>' +
            '<ul class="listing-detail ps-3">' + claimsHtml + '</ul>' +
        '</div>';
    makeCardClickable(col, item, {});
    return col;
}

// Lightweight tick that only touches the countdown text so the grid
// does not need a full re-render every few seconds.
setInterval(function () {
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
        const bestBeforeAt = el.getAttribute('data-countdown');
        const remainingMs = new Date(bestBeforeAt).getTime() - Date.now();
        el.textContent = formatCountdown(remainingMs);
    });
}, 15000);
