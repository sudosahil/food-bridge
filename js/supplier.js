/*
 * Surplus Food Bridge - js/supplier.js
 * Logic for supplier.html: a public-style profile page for a donor,
 * showing their stats, reviews, and active listings. The donor
 * themself can also edit their contact details from here.
 */

document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'supplier') return;
    initSupplierPage();
});

async function initSupplierPage() {
    const user = requireAnyLogin();
    if (!user) return;

    setupNavbar(user, '<a href="' + dashboardUrlForRole(user.role) + '">Back to Dashboard</a>');

    const params = new URLSearchParams(window.location.search);
    const donorUsername = params.get('donor');

    const [users, listings, reviews] = await Promise.all([fetchUsers(), fetchListings(), fetchReviews()]);
    const donorUser = users.find(function (u) { return u.username === donorUsername && u.role === 'donor'; });

    if (!donorUser) {
        document.getElementById('notFoundMessage').classList.remove('d-none');
        return;
    }

    document.getElementById('profileContent').classList.remove('d-none');
    renderProfileHeader(donorUser, reviews);
    renderProfileStats(listings, donorUser.username);
    renderProfileListings(listings, donorUser.username, user);
    renderProfileReviews(reviews, donorUser.username);

    if (user.username === donorUser.username && user.role === 'donor') {
        wireEditProfile(donorUser);
    }
}

function renderProfileHeader(donorUser, reviews) {
    const zone = getZoneById(donorUser.zoneId);
    const rating = computeDonorRating(reviews, donorUser.username);

    document.getElementById('profileName').textContent = donorUser.name;
    document.getElementById('profileAddress').textContent = (zone ? zone.name + ' - ' : '') + (donorUser.address || '');
    document.getElementById('profilePhone').textContent = donorUser.phone || '';
    document.getElementById('profileDescription').textContent = donorUser.description || 'This supplier has not added a description yet.';

    const ratingBox = document.getElementById('profileRating');
    ratingBox.innerHTML = rating.count > 0
        ? renderStarsHtml(rating.avg) + ' <span class="listing-meta">(' + rating.avg.toFixed(1) + ' from ' + rating.count + ' review' + (rating.count === 1 ? '' : 's') + ')</span>'
        : '<span class="listing-meta">No reviews yet</span>';
}

function renderProfileStats(listings, donorUsername) {
    const stats = computeDonorStats(listings, donorUsername);
    document.getElementById('statPosted').textContent = stats.totalPosted;
    document.getElementById('statRescued').textContent = stats.totalRescued;
    document.getElementById('statCompleted').textContent = stats.completedCount;
    document.getElementById('statNgoServed').textContent = stats.ngoServed;
}

function renderProfileListings(listings, donorUsername, viewer) {
    const grid = document.getElementById('profileListingsGrid');
    grid.innerHTML = '';

    const active = listings.filter(function (l) { return l.donorUsername === donorUsername && l.status !== 'claimed'; })
        .sort(function (a, b) { return new Date(a.bestBeforeAt) - new Date(b.bestBeforeAt); });

    if (active.length === 0) {
        grid.innerHTML = '<p class="empty-state">No active listings right now.</p>';
        return;
    }

    active.forEach(function (item) {
        const freshness = getFreshnessInfo(item);
        const remaining = remainingQuantity(item);
        const col = document.createElement('div');
        col.className = 'col-md-4 mb-4';
        col.innerHTML =
            '<div class="card listing-card h-100">' +
                '<div>' + renderBadgesHtml(item) + '</div>' +
                '<h5 class="listing-title">' + escapeHtml(item.foodName) + '</h5>' +
                '<p class="listing-detail"><strong>Remaining:</strong> ' + remaining + ' / ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + '</p>' +
                '<p class="listing-meta">' + formatCountdown(freshness.remainingMs) + '</p>' +
            '</div>';

        const options = viewer.role === 'ngo'
            ? { onClaim: function (listingId, qty) { claimFromProfile(listingId, qty, donorUsername, viewer); }, currentUsername: viewer.username }
            : {};
        makeCardClickable(col, item, options);
        grid.appendChild(col);
    });
}

async function claimFromProfile(listingId, qty, donorUsername, viewer) {
    try {
        await performClaim(listingId, qty, viewer.username, viewer.name);
        const listings = await fetchListings();
        renderProfileStats(listings, donorUsername);
        renderProfileListings(listings, donorUsername, viewer);
        alert('Claimed. You can find pickup details on your NGO dashboard.');
    } catch (err) {
        alert(err.message);
    }
}

function renderProfileReviews(reviews, donorUsername) {
    const container = document.getElementById('profileReviews');
    const mine = reviews.filter(function (r) { return r.donorUsername === donorUsername; })
        .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

    container.innerHTML = '';
    if (mine.length === 0) {
        container.innerHTML = '<p class="empty-state">No NGO has left a review for this supplier yet.</p>';
        return;
    }

    mine.forEach(function (review) {
        const card = document.createElement('div');
        card.className = 'review-card';
        card.innerHTML =
            '<div class="review-header">' +
                '<span class="review-author">' + escapeHtml(review.ngoName) + '</span>' +
                '<span class="review-date">' + formatDate(review.createdAt) + '</span>' +
            '</div>' +
            renderStarsHtml(review.rating) +
            '<p class="mt-2">' + escapeHtml(review.comment) + '</p>';
        container.appendChild(card);
    });
}

function wireEditProfile(donorUser) {
    const card = document.getElementById('editProfileCard');
    card.classList.remove('d-none');

    populateSelect('editZone', ZONES, function (z) { return z.id; }, function (z) { return z.name; });
    document.getElementById('editPhone').value = donorUser.phone || '';
    document.getElementById('editZone').value = donorUser.zoneId || '';
    document.getElementById('editAddress').value = donorUser.address || '';
    document.getElementById('editDescription').value = donorUser.description || '';

    document.getElementById('editProfileForm').addEventListener('submit', async function (event) {
        event.preventDefault();

        const phone = document.getElementById('editPhone').value.trim();
        const zoneId = document.getElementById('editZone').value;
        const address = document.getElementById('editAddress').value.trim();
        const description = document.getElementById('editDescription').value.trim();

        if (!phone || !zoneId || !address) {
            alert('Phone, zone, and address are required.');
            return;
        }

        const users = await fetchUsers();
        const target = users.find(function (u) { return u.username === donorUser.username; });
        target.phone = phone;
        target.zoneId = zoneId;
        target.address = address;
        target.description = description;
        await saveUsers(users);

        alert('Profile updated.');
        window.location.reload();
    });
}
