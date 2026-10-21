/*
 * Surplus Food Bridge - js/admin-user.js
 * Logic for admin-user.html: one donor's or NGO's full profile for admins.
 * Shows what they registered with, their listings (donor) or claims (NGO),
 * reviews and activity, and lets the admin approve, unapprove, suspend or
 * delete the account. The server enforces the admin role on every call.
 */

let overview = null;

// ---------- ENTRY POINT ----------
document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'admin-user') return;
    initAdminUserPage();
});

async function initAdminUserPage() {
    const user = await requireLogin('admin');
    if (!user) return;

    setupNavbar(user, '<a href="admin.html">Admin dashboard</a>');
    document.getElementById('approveBtn').addEventListener('click', function (e) { act(e.currentTarget, 'verify', 'approved'); });
    document.getElementById('unapproveBtn').addEventListener('click', function (e) { act(e.currentTarget, 'verify', 'unapproved'); });
    document.getElementById('suspendBtn').addEventListener('click', function (e) { act(e.currentTarget, 'suspend'); });
    document.getElementById('deleteBtn').addEventListener('click', function (e) { act(e.currentTarget, 'delete'); });

    await load();
    setInterval(load, 30000);
}

async function load() {
    const id = new URLSearchParams(window.location.search).get('id');
    try {
        overview = await apiRequest('GET', '/admin/users/' + encodeURIComponent(id) + '/overview');
    } catch (err) {
        if (err.status !== 404) throw err;
        document.getElementById('profileContent').classList.add('d-none');
        document.getElementById('notFoundMessage').classList.remove('d-none');
        return;
    }
    document.getElementById('profileContent').classList.remove('d-none');
    renderProfile();
}

// ---------- ACTIONS ----------
async function act(button, kind, value) {
    const u = overview.user;
    const base = '/admin/users/' + encodeURIComponent(u.id);

    if (kind === 'delete' && !confirm('Delete ' + u.name + '? ' + (u.role === 'donor' ? 'Their listings and the reviews about them are removed too.' : 'The reviews they wrote are removed; their claims stay on the listings as history.') + ' This cannot be undone.')) return;

    showActionError('');
    await runOnce(button, async function () {
        try {
            if (kind === 'verify') await apiRequest('PATCH', base + '/verification', { status: value });
            else if (kind === 'suspend') await apiRequest('PATCH', base, { active: !u.active });
            else {
                await apiRequest('DELETE', base);
                window.location.href = 'admin.html';
                return;
            }
        } catch (err) {
            showActionError(err.message);
        }
        await load();
    });
}

function showActionError(message) {
    const box = document.getElementById('actionError');
    box.textContent = message;
    box.classList.toggle('d-none', !message);
}

// ---------- RENDERING ----------
function renderProfile() {
    const u = overview.user;
    const zone = getZoneById(u.zoneId);
    const roleLabel = u.role === 'ngo' ? 'NGO' : 'Donor';

    document.title = u.name + ' - Surplus Food Bridge';
    document.getElementById('userName').textContent = u.name;
    document.getElementById('userSubtitle').textContent = roleLabel + ' account, registered ' + formatDateTime(u.createdAt);
    document.getElementById('userChips').innerHTML =
        '<span class="badge status-badge status-available">' + roleLabel + '</span>' +
        renderVerificationChipHtml(u.verificationStatus) +
        (u.active ? '<span class="badge status-badge status-active-user">Active</span>' : '<span class="badge status-badge status-suspended">Suspended</span>');

    renderVerifyPanel(u);

    document.getElementById('userDetails').innerHTML =
        '<dt>Username</dt><dd>' + escapeHtml(u.username) + '</dd>' +
        '<dt>' + (u.role === 'ngo' ? 'NGO registration number' : 'Food licence number') + '</dt><dd>' + escapeHtml(u.registrationNumber || 'Not provided') + '</dd>' +
        '<dt>Zone</dt><dd>' + escapeHtml(zone ? zone.name : '-') + '</dd>' +
        '<dt>Address</dt><dd>' + escapeHtml(u.address || '-') + '</dd>' +
        '<dt>Phone</dt><dd>' + escapeHtml(u.phone || '-') + '</dd>' +
        (u.role === 'donor' ? '<dt>Description</dt><dd>' + escapeHtml(u.description || 'None') + '</dd>' : '') +
        '<dt>Approved on</dt><dd>' + (u.verifiedAt ? formatDateTime(u.verifiedAt) : '-') + '</dd>';

    if (u.role === 'donor') renderDonorItems(u);
    else renderNgoItems(u);
    renderReviews(u);
    renderActivity();
}

function renderVerifyPanel(u) {
    const status = u.verificationStatus;
    document.getElementById('verifyPanel').className = 'verify-panel verify-panel-' + status;
    document.getElementById('verifyTitle').textContent = status === 'pending' ? 'Waiting for your decision'
        : (status === 'approved' ? 'Approved' : 'Unapproved');
    document.getElementById('verifyText').textContent = status === 'pending'
        ? 'Check the registration number and details below, then approve or unapprove. Until then this account can browse but not ' + (u.role === 'donor' ? 'post food.' : 'claim food.')
        : (status === 'approved'
            ? 'This account can ' + (u.role === 'donor' ? 'post food.' : 'claim food.')
            : 'This account can browse but not ' + (u.role === 'donor' ? 'post food.' : 'claim food.'));

    document.getElementById('approveBtn').classList.toggle('d-none', status === 'approved');
    document.getElementById('unapproveBtn').classList.toggle('d-none', status === 'unapproved');
    document.getElementById('suspendBtn').textContent = u.active ? 'Suspend' : 'Reactivate';
}

function listingLink(l) {
    return '<a class="listing-donor-link" href="listing.html?id=' + encodeURIComponent(l.id) + '">' + escapeHtml(l.foodName) + '</a>';
}

function renderDonorItems(u) {
    document.getElementById('itemsTitle').textContent = 'Listings (' + overview.listings.length + ')';
    document.getElementById('itemsHead').innerHTML = '<tr><th>Photo</th><th>Food</th><th>Claimed</th><th>Status</th><th>Pickup by</th></tr>';
    const rows = overview.listings.map(function (l) {
        const thumb = l.photoUrl ? '<img class="admin-thumb" src="' + escapeHtml(l.photoUrl) + '" alt="" loading="lazy">' : '<div class="admin-thumb"></div>';
        return '<tr><td>' + thumb + '</td><td>' + listingLink(l) + '</td>' +
            '<td>' + l.claimedQuantity + ' / ' + l.totalQuantity + ' ' + escapeHtml(l.unit) + '</td>' +
            '<td>' + renderBadgesHtml(l) + '</td><td>' + formatDateTime(l.bestBeforeAt) + '</td></tr>';
    });
    document.getElementById('itemsBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="5" class="empty-state">This donor has not posted anything yet.</td></tr>';
}

function renderNgoItems(u) {
    const claims = [];
    overview.listings.forEach(function (l) {
        l.claims.forEach(function (c) { if (c.ngoUsername === u.username) claims.push({ listing: l, claim: c }); });
    });
    claims.sort(function (a, b) { return new Date(b.claim.claimedAt) - new Date(a.claim.claimedAt); });

    document.getElementById('itemsTitle').textContent = 'Claims (' + claims.length + ')';
    document.getElementById('itemsHead').innerHTML = '<tr><th>Food</th><th>From</th><th>Quantity</th><th>Claimed at</th></tr>';
    const rows = claims.map(function (e) {
        return '<tr><td>' + listingLink(e.listing) + '</td><td>' + escapeHtml(e.listing.donorName) + '</td>' +
            '<td>' + e.claim.quantity + ' ' + escapeHtml(e.listing.unit) + '</td><td>' + formatDateTime(e.claim.claimedAt) + '</td></tr>';
    });
    document.getElementById('itemsBody').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="4" class="empty-state">This NGO has not claimed anything yet.</td></tr>';
}

function renderReviews(u) {
    const container = document.getElementById('userReviews');
    document.getElementById('reviewsTitle').textContent = (u.role === 'donor' ? 'Reviews received' : 'Reviews written') + ' (' + overview.reviews.length + ')';
    if (overview.reviews.length === 0) {
        container.innerHTML = '<p class="empty-state">No reviews yet.</p>';
        return;
    }
    container.innerHTML = overview.reviews.map(function (r) {
        const who = u.role === 'donor' ? r.ngoName : 'About ' + r.donorUsername;
        return '<div class="review-card"><div class="review-header"><span class="review-author">' + escapeHtml(who) + '</span>' +
            '<span class="review-date">' + formatDate(r.createdAt) + '</span></div>' +
            renderStarsHtml(r.rating) + '<p class="mt-2">' + escapeHtml(r.comment) + '</p></div>';
    }).join('');
}

function renderActivity() {
    const body = document.getElementById('activityBody');
    if (overview.transactions.length === 0) {
        body.innerHTML = '<tr><td colspan="3" class="empty-state">No activity yet.</td></tr>';
        return;
    }
    body.innerHTML = overview.transactions.map(function (tx) {
        return '<tr><td class="text-nowrap">' + formatDateTime(tx.createdAt) + '<span class="listing-meta d-block">' + formatRelativeTime(tx.createdAt) + '</span></td>' +
            '<td>' + renderTransactionTypeHtml(tx.type) + '</td><td>' + escapeHtml(tx.summary) + '</td></tr>';
    }).join('');
}
