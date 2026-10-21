/*
 * Surplus Food Bridge - js/supplier.js
 * Logic for supplier.html: a public-style profile page for a donor,
 * showing their stats, reviews, and active listings. The donor
 * themself can also edit their contact details from here.
 */

// ---------- ENTRY POINT ----------
// Reads ?donor=<username> from the URL (see the query string handling
// below) so this same page works for every donor's profile.
document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'supplier') return;
    initSupplierPage();
});

async function initSupplierPage() {
    const user = await requireAnyLogin();
    if (!user) return;

    setupNavbar(user, '<a href="' + dashboardUrlForRole(user.role) + '">Back to Dashboard</a>');

    const params = new URLSearchParams(window.location.search);
    const donorUsername = params.get('donor');

    let donorUser;
    try {
        donorUser = await fetchDonor(donorUsername);
    } catch (err) {
        if (err.status !== 404) throw err;
        document.getElementById('notFoundMessage').classList.remove('d-none');
        return;
    }
    const [listings, reviews] = await Promise.all([fetchListings(), fetchReviews()]);

    document.getElementById('profileContent').classList.remove('d-none');
    renderProfileHeader(donorUser, reviews);
    renderProfileStats(listings, donorUser.username);
    renderProfileListings(listings, donorUser.username, user);
    renderProfileReviews(reviews, donorUser.username);

    if (user.username === donorUser.username && user.role === 'donor') {
        wireEditProfile(donorUser);
    }
}

// ---------- PROFILE HEADER + STATS ----------
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

// ---------- ACTIVE LISTINGS + CLAIMING FROM A PROFILE ----------
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
        col.className = 'col-xl-3 col-lg-4 col-md-6 mb-3';
        col.innerHTML =
            '<div class="card listing-card h-100">' +
                renderListingMediaHtml(item) +
                '<h5 class="listing-title">' + escapeHtml(item.foodName) + '</h5>' +
                '<p class="listing-detail"><strong>Remaining:</strong> ' + remaining + ' / ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + '</p>' +
                renderShelfLifeHtml(item) +
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
    let claimed = false;
    try {
        await performClaim(listingId, qty);
        claimed = true;
    } catch (err) {
        alert(err.message);
    }

    // Refresh either way so the card shows what is really left.
    const listings = await fetchListings();
    renderProfileStats(listings, donorUsername);
    renderProfileListings(listings, donorUsername, viewer);
    if (claimed) alert('Claimed. You can find pickup details on your NGO dashboard.');
}

// ---------- REVIEWS ----------
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

// ---------- EDIT-OWN-PROFILE FORM ----------
// Only wired up when the logged-in donor is viewing their own profile.
function wireEditProfile(donorUser) {
    const card = document.getElementById('editProfileCard');
    card.classList.remove('d-none');

    populateSelect('editZone', ZONES, function (z) { return z.id; }, function (z) { return z.name; });
    wireDigitsOnlyPhoneInput(document.getElementById('editPhone'));
    document.getElementById('editPhone').value = donorUser.phone || '';
    document.getElementById('editZone').value = donorUser.zoneId || '';
    document.getElementById('editAddress').value = donorUser.address || '';
    document.getElementById('editDescription').value = donorUser.description || '';

    document.getElementById('editProfileForm').addEventListener('submit', async function (event) {
        event.preventDefault();

        const phoneInput = document.getElementById('editPhone');
        const phone = phoneInput.value.trim();
        const zoneId = document.getElementById('editZone').value;
        const address = document.getElementById('editAddress').value.trim();
        const description = document.getElementById('editDescription').value.trim();

        if (!isValidPhone(phone)) {
            phoneInput.setCustomValidity('Enter exactly 10 digits.');
            phoneInput.reportValidity();
            return;
        }
        phoneInput.setCustomValidity('');

        if (!zoneId || !address) {
            alert('Zone and address are required.');
            return;
        }

        try {
            await updateMyProfile({ phone: phone, zoneId: zoneId, address: address, description: description });
        } catch (err) {
            alert(err.message);
            return;
        }

        alert('Profile updated.');
        window.location.reload();
    });
}
