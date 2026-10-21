/*
 * Surplus Food Bridge - js/admin.js
 * Logic for admin.html: platform stats plus moderation tables for users
 * (suspend / reactivate / delete), listings (remove) and reviews (delete).
 * Every action goes through /api/admin/* or the admin-only DELETE routes;
 * the server enforces the admin role, this page just hides the buttons.
 */

let adminState = { users: [], listings: [], reviews: [] };

// ---------- ENTRY POINT ----------
document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'admin') return;
    initAdminPage();
});

async function initAdminPage() {
    const user = await requireLogin('admin');
    if (!user) return;

    setupNavbar(user);
    document.getElementById('userSearch').addEventListener('input', renderUsers);
    document.getElementById('userVerificationFilter').addEventListener('change', renderUsers);
    document.getElementById('usersBody').addEventListener('click', handleUserAction);
    document.getElementById('listingsBody').addEventListener('click', handleListingAction);
    document.getElementById('reviewsBody').addEventListener('click', handleReviewAction);

    await loadAll();
    setInterval(loadAll, 30000);
}

// ---------- DATA ----------
async function loadAll() {
    try {
        const [stats, users, listings, reviews] = await Promise.all([
            apiRequest('GET', '/admin/stats'),
            apiRequest('GET', '/admin/users'),
            fetchListings(),
            fetchReviews()
        ]);
        adminState = { users: users, listings: listings, reviews: reviews };
        renderStats(stats);
        renderUsers();
        renderListings();
        renderReviews();
    } catch (err) {
        showAdminError(err.message);
    }
}

function showAdminError(message) {
    const box = document.getElementById('adminError');
    box.textContent = message;
    box.classList.toggle('d-none', !message);
}

// Runs a moderation request, shows any server error, and refreshes everything.
async function moderate(button, request) {
    showAdminError('');
    await runOnce(button, async function () {
        try {
            await request();
        } catch (err) {
            showAdminError(err.message);
        }
        await loadAll();
    });
}

// ---------- STATS ----------
function renderStats(stats) {
    document.getElementById('statPending').textContent = stats.pendingApprovals;
    document.getElementById('statDonors').textContent = stats.donors;
    document.getElementById('statNgos').textContent = stats.ngos;
    document.getElementById('statSuspended').textContent = stats.suspendedUsers;
    document.getElementById('statActiveListings').textContent = stats.activeListings;
    document.getElementById('statTotalListings').textContent = stats.totalListings;
    document.getElementById('statRescued').textContent = stats.unitsRescued;
    document.getElementById('statReviews').textContent = stats.totalReviews;
}

// ---------- USERS ----------
function renderUsers() {
    const query = document.getElementById('userSearch').value.trim().toLowerCase();
    const verification = document.getElementById('userVerificationFilter').value;
    // Accounts waiting for a decision come first.
    const order = { pending: 0, unapproved: 1, approved: 2 };
    const rows = adminState.users.slice().sort(function (a, b) {
        return (order[a.verificationStatus] - order[b.verificationStatus]) || a.name.localeCompare(b.name);
    }).filter(function (u) {
        if (verification && u.verificationStatus !== verification) return false;
        return !query || (u.name + ' ' + u.username + ' ' + u.role + ' ' + (u.registrationNumber || '')).toLowerCase().indexOf(query) !== -1;
    });

    const body = document.getElementById('usersBody');
    if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="8" class="empty-state">No users match.</td></tr>';
        return;
    }

    body.innerHTML = rows.map(function (u) {
        const zone = getZoneById(u.zoneId);
        const statusBadge = u.active
            ? '<span class="badge status-badge status-active-user">Active</span>'
            : '<span class="badge status-badge status-suspended">Suspended</span>';
        const id = escapeHtml(u.id);
        const approveBtn = u.verificationStatus !== 'approved'
            ? '<button type="button" class="btn btn-primary-brown btn-sm me-1" data-action="approve" data-id="' + id + '">Approve</button>' : '';
        const unapproveBtn = u.verificationStatus !== 'unapproved'
            ? '<button type="button" class="btn btn-outline-brown btn-sm me-1" data-action="unapprove" data-id="' + id + '">Unapprove</button>' : '';
        const actions = u.role === 'admin'
            ? '<span class="listing-meta">Protected</span>'
            : approveBtn + unapproveBtn +
              '<button type="button" class="btn btn-outline-brown btn-sm me-1" data-action="toggle" data-id="' + id + '">' + (u.active ? 'Suspend' : 'Reactivate') + '</button>' +
              '<button type="button" class="btn btn-outline-brown btn-sm" data-action="delete" data-id="' + id + '" data-name="' + escapeHtml(u.name) + '">Delete</button>';
        const nameCell = u.role === 'admin'
            ? escapeHtml(u.name)
            : '<a class="listing-donor-link" href="admin-user.html?id=' + encodeURIComponent(u.id) + '">' + escapeHtml(u.name) + '</a>';

        return '<tr>' +
            '<td>' + nameCell + '</td>' +
            '<td>' + escapeHtml(u.username) + '</td>' +
            '<td>' + escapeHtml(u.role) + '</td>' +
            '<td>' + escapeHtml(u.registrationNumber || '-') + '</td>' +
            '<td>' + escapeHtml(zone ? zone.name : '-') + '</td>' +
            '<td>' + (u.role === 'admin' ? '-' : renderVerificationChipHtml(u.verificationStatus)) + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td class="text-end text-nowrap">' + actions + '</td>' +
        '</tr>';
    }).join('');
}

function handleUserAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.getAttribute('data-id');

    const action = button.getAttribute('data-action');
    if (action === 'approve' || action === 'unapprove') {
        moderate(button, function () {
            return apiRequest('PATCH', '/admin/users/' + encodeURIComponent(id) + '/verification', { status: action === 'approve' ? 'approved' : 'unapproved' });
        });
    } else if (action === 'toggle') {
        const user = adminState.users.find(function (u) { return u.id === id; });
        moderate(button, function () { return apiRequest('PATCH', '/admin/users/' + encodeURIComponent(id), { active: !user.active }); });
    } else {
        const name = button.getAttribute('data-name');
        if (!confirm('Delete ' + name + '? Their listings (if a donor) and reviews will be removed too. This cannot be undone.')) return;
        moderate(button, function () { return apiRequest('DELETE', '/admin/users/' + encodeURIComponent(id)); });
    }
}

// ---------- LISTINGS ----------
function renderListings() {
    const body = document.getElementById('listingsBody');
    if (adminState.listings.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="empty-state">No listings yet.</td></tr>';
        return;
    }

    body.innerHTML = adminState.listings.map(function (l) {
        const thumb = l.photoUrl
            ? '<img class="admin-thumb" src="' + escapeHtml(l.photoUrl) + '" alt="Photo of ' + escapeHtml(l.foodName) + '" loading="lazy">'
            : '<div class="admin-thumb"></div>';
        return '<tr>' +
            '<td>' + thumb + '</td>' +
            '<td><a class="listing-donor-link" href="listing.html?id=' + encodeURIComponent(l.id) + '">' + escapeHtml(l.foodName) + '</a></td>' +
            '<td>' + escapeHtml(l.donorName) + '</td>' +
            '<td>' + l.claimedQuantity + ' / ' + l.totalQuantity + ' ' + escapeHtml(l.unit) + '</td>' +
            '<td>' + renderBadgesHtml(l) + '</td>' +
            '<td>' + formatDateTime(l.bestBeforeAt) + '</td>' +
            '<td class="text-end"><button type="button" class="btn btn-outline-brown btn-sm" data-action="remove" data-id="' + escapeHtml(l.id) + '" data-name="' + escapeHtml(l.foodName) + '">Remove</button></td>' +
        '</tr>';
    }).join('');
}

function handleListingAction(event) {
    const button = event.target.closest('button[data-action="remove"]');
    if (!button) return;
    if (!confirm('Remove "' + button.getAttribute('data-name') + '"? Its photo and reviews are deleted too.')) return;
    moderate(button, function () { return apiRequest('DELETE', '/listings/' + encodeURIComponent(button.getAttribute('data-id'))); });
}

// ---------- REVIEWS ----------
function renderReviews() {
    const body = document.getElementById('reviewsBody');
    if (adminState.reviews.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="empty-state">No reviews yet.</td></tr>';
        return;
    }

    body.innerHTML = adminState.reviews.map(function (r) {
        return '<tr>' +
            '<td>' + escapeHtml(r.donorUsername) + '</td>' +
            '<td>' + escapeHtml(r.ngoName) + '</td>' +
            '<td>' + renderStarsHtml(r.rating) + '</td>' +
            '<td>' + escapeHtml(r.comment) + '</td>' +
            '<td>' + formatDate(r.createdAt) + '</td>' +
            '<td class="text-end"><button type="button" class="btn btn-outline-brown btn-sm" data-action="delete" data-id="' + escapeHtml(r.id) + '">Delete</button></td>' +
        '</tr>';
    }).join('');
}

function handleReviewAction(event) {
    const button = event.target.closest('button[data-action="delete"]');
    if (!button) return;
    if (!confirm('Delete this review?')) return;
    moderate(button, function () { return apiRequest('DELETE', '/reviews/' + encodeURIComponent(button.getAttribute('data-id'))); });
}
