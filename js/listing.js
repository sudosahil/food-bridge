/*
 * Surplus Food Bridge - js/listing.js
 * Logic for listing.html: one listing in full (photo, details, claims,
 * activity). The donor who owns it, and admins, can edit it; approved NGOs
 * can claim from it. Opened as listing.html?id=<listing id>.
 */

let pageUser = null;
let pageListing = null;
let adminUserIds = {};

// ---------- ENTRY POINT ----------
document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'listing') return;
    initListingPage();
});

async function initListingPage() {
    pageUser = await requireAnyLogin();
    if (!pageUser) return;

    setupNavbar(pageUser, '<a href="' + dashboardUrlForRole(pageUser.role) + '">Dashboard</a>');

    const id = new URLSearchParams(window.location.search).get('id');
    try {
        pageListing = await fetchListing(id);
    } catch (err) {
        if (err.status !== 404) throw err;
        document.getElementById('notFoundMessage').classList.remove('d-none');
        return;
    }

    if (pageUser.role === 'admin') {
        // So claimant names can link to their admin profile.
        const users = await apiRequest('GET', '/admin/users');
        users.forEach(function (u) { adminUserIds[u.username] = u.id; });
    }

    document.getElementById('listingContent').classList.remove('d-none');
    populateSelect('editUnit', UNITS, function (u) { return u; }, function (u) { return u; });
    populateSelect('editZone', ZONES, function (z) { return z.id; }, function (z) { return z.name; });
    wireEditForm();
    await renderAll();

    // Claims by other NGOs change what is left, so keep it fresh.
    setInterval(refresh, 20000);
}

async function refresh() {
    if (!document.getElementById('editCard').classList.contains('d-none')) return; // never overwrite an open edit form
    try {
        pageListing = await fetchListing(pageListing.id);
        await renderAll();
    } catch (err) {
        // Removed or hidden meanwhile; the next full load will show it.
    }
}

// ---------- RENDERING ----------
async function renderAll() {
    renderHeader();
    renderDetails();
    renderClaimBox();
    renderClaims();
    await renderActivity();
}

function canEditListing() {
    const owns = pageUser.role === 'donor' && pageUser.username === pageListing.donorUsername;
    return (owns || pageUser.role === 'admin') && pageListing.status !== 'claimed';
}

function renderHeader() {
    const item = pageListing;
    document.title = item.foodName + ' - Surplus Food Bridge';
    document.getElementById('listingTitle').textContent = item.foodName;
    document.getElementById('listingSubtitle').textContent = 'Posted by ' + item.donorName + ' on ' + formatDateTime(item.postedAt);

    const editBtn = document.getElementById('editToggleBtn');
    editBtn.classList.toggle('d-none', !canEditListing());
}

function renderDetails() {
    const item = pageListing;
    const zone = getZoneById(item.zoneId);
    const freshness = getFreshnessInfo(item);
    const remaining = remainingQuantity(item);
    const claimedPercent = Math.min(100, Math.round((item.claimedQuantity / item.totalQuantity) * 100));

    document.getElementById('listingMedia').innerHTML = renderListingPhotoHtml(item, 'listing-photo-large');
    document.getElementById('listingGauge').innerHTML = renderShelfLifeHtml(item);
    document.getElementById('listingCountdown').textContent = formatCountdown(freshness.remainingMs);

    const donorLink = pageUser.role === 'admin' && adminUserIds[item.donorUsername]
        ? 'admin-user.html?id=' + encodeURIComponent(adminUserIds[item.donorUsername])
        : 'supplier.html?donor=' + encodeURIComponent(item.donorUsername);

    document.getElementById('listingDetails').innerHTML =
        '<dt>Donor</dt><dd><a class="listing-donor-link" href="' + donorLink + '">' + escapeHtml(item.donorName) + '</a></dd>' +
        '<dt>Zone</dt><dd>' + escapeHtml(zone ? zone.name : 'Unknown') + '</dd>' +
        '<dt>Pickup instructions</dt><dd>' + escapeHtml(item.addressDetail) + '</dd>' +
        '<dt>Prepared</dt><dd>' + formatDateTime(item.preparedAt) + '</dd>' +
        '<dt>Pickup by</dt><dd>' + formatDateTime(item.bestBeforeAt) + '</dd>' +
        '<dt>Quantity</dt><dd>' + item.claimedQuantity + ' of ' + item.totalQuantity + ' ' + escapeHtml(item.unit) + ' claimed, ' + remaining + ' left' +
            '<div class="inventory-progress"><div class="inventory-progress-fill" style="width:' + claimedPercent + '%"></div></div></dd>' +
        '<dt>Status</dt><dd>' + renderBadgesHtml(item) + '</dd>';
}

// Approved NGOs can claim straight from here, same rules as the dashboard.
function renderClaimBox() {
    const box = document.getElementById('listingClaimBox');
    const item = pageListing;
    box.innerHTML = '';
    if (pageUser.role !== 'ngo') return;

    const remaining = remainingQuantity(item);
    if (item.claims.some(function (c) { return c.ngoUsername === pageUser.username; })) {
        box.innerHTML = '<p class="listing-meta">You already claimed part of this listing.</p>';
    } else if (isExpired(item) || remaining <= 0) {
        box.innerHTML = '<p class="listing-meta">This listing can no longer be claimed.</p>';
    } else {
        box.innerHTML =
            '<div class="claim-form">' +
                '<input type="number" id="pageClaimQty" class="form-control form-control-sm" min="0.1" max="' + remaining + '" step="any" value="' + remaining + '" aria-label="Quantity to claim">' +
                '<button type="button" class="btn btn-claim" id="pageClaimBtn">Claim</button>' +
            '</div>';
        document.getElementById('pageClaimBtn').addEventListener('click', function (event) {
            const qty = parseFloat(document.getElementById('pageClaimQty').value);
            runOnce(event.currentTarget, async function () {
                try {
                    await performClaim(item.id, qty);
                } catch (err) {
                    alert(err.message);
                }
                pageListing = await fetchListing(item.id);
                await renderAll();
            });
        });
    }
}

function renderClaims() {
    const body = document.getElementById('claimsBody');
    const item = pageListing;
    if (item.claims.length === 0) {
        body.innerHTML = '<tr><td colspan="3" class="empty-state">No claims yet.</td></tr>';
        return;
    }
    body.innerHTML = item.claims.map(function (c) {
        const profileId = adminUserIds[c.ngoUsername];
        const name = profileId
            ? '<a class="listing-donor-link" href="admin-user.html?id=' + encodeURIComponent(profileId) + '">' + escapeHtml(c.ngoName) + '</a>'
            : escapeHtml(c.ngoName);
        return '<tr><td>' + name + '</td><td>' + c.quantity + ' ' + escapeHtml(item.unit) + '</td><td>' + formatDateTime(c.claimedAt) + '</td></tr>';
    }).join('');
}

async function renderActivity() {
    const body = document.getElementById('activityBody');
    try {
        const rows = await fetchTransactions({ listingId: pageListing.id, limit: 100 });
        if (rows.length === 0) {
            body.innerHTML = '<tr><td colspan="3" class="empty-state">No activity you can see yet.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(function (tx) {
            return '<tr><td class="text-nowrap">' + formatDateTime(tx.createdAt) + '<span class="listing-meta d-block">' + formatRelativeTime(tx.createdAt) + '</span></td>' +
                '<td>' + renderTransactionTypeHtml(tx.type) + '</td><td>' + escapeHtml(tx.summary) + '</td></tr>';
        }).join('');
    } catch (err) {
        body.innerHTML = '<tr><td colspan="3" class="empty-state">' + escapeHtml(err.message) + '</td></tr>';
    }
}

// ---------- EDIT FORM ----------
const EDIT_MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm", not UTC ISO.
function toLocalInputValue(isoString) {
    const d = new Date(isoString);
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function wireEditForm() {
    const card = document.getElementById('editCard');
    const errorBox = document.getElementById('editError');
    const photoInput = document.getElementById('editPhoto');
    const preview = document.getElementById('editPhotoPreview');

    document.getElementById('editToggleBtn').addEventListener('click', function () {
        fillEditForm();
        card.classList.remove('d-none');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('editCancelBtn').addEventListener('click', function () {
        card.classList.add('d-none');
    });

    photoInput.addEventListener('change', function () {
        errorBox.classList.add('d-none');
        if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
        const file = photoInput.files[0];
        if (!file) { preview.classList.add('d-none'); return; }
        if (file.size > EDIT_MAX_PHOTO_BYTES) {
            photoInput.value = '';
            preview.classList.add('d-none');
            showEditError('Photo is too large (max 3 MB).');
            return;
        }
        document.getElementById('editRemovePhoto').checked = false;
        preview.src = URL.createObjectURL(file);
        preview.classList.remove('d-none');
    });

    document.getElementById('editForm').addEventListener('submit', function (event) {
        event.preventDefault();
        runOnce(event.currentTarget.querySelector('button[type="submit"]'), submitEdit);
    });
}

function showEditError(message) {
    const box = document.getElementById('editError');
    box.textContent = message;
    box.classList.remove('d-none');
}

function fillEditForm() {
    const item = pageListing;
    const hasClaims = item.claims.length > 0;
    document.getElementById('editError').classList.add('d-none');
    document.getElementById('editFoodName').value = item.foodName;
    document.getElementById('editQuantity').value = item.totalQuantity;
    document.getElementById('editQuantity').min = hasClaims ? item.claimedQuantity : 0.1;
    document.getElementById('editQuantityHint').textContent = hasClaims
        ? 'At least ' + item.claimedQuantity + ' ' + item.unit + ', which is already claimed.' : '';
    document.getElementById('editUnit').value = item.unit;
    document.getElementById('editUnit').disabled = hasClaims;
    document.getElementById('editUnitHint').textContent = hasClaims ? 'Locked because an NGO has claimed from this listing.' : '';
    document.getElementById('editZone').value = item.zoneId;
    document.getElementById('editAddressDetail').value = item.addressDetail;
    document.getElementById('editPreparedAt').value = toLocalInputValue(item.preparedAt);
    document.getElementById('editBestBefore').value = toLocalInputValue(item.bestBeforeAt);
    document.getElementById('editPhoto').value = '';
    document.getElementById('editRemovePhoto').checked = false;
    document.getElementById('removePhotoRow').classList.toggle('d-none', !item.photoUrl);
    document.getElementById('editPhotoPreview').classList.add('d-none');
}

async function submitEdit() {
    document.getElementById('editError').classList.add('d-none');

    const quantity = parseFloat(document.getElementById('editQuantity').value);
    const preparedAt = new Date(document.getElementById('editPreparedAt').value);
    const bestBefore = new Date(document.getElementById('editBestBefore').value);
    if (!(quantity > 0)) return showEditError('Quantity must be greater than zero.');
    if (Number.isNaN(preparedAt.getTime()) || Number.isNaN(bestBefore.getTime())) return showEditError('Enter both times.');
    if (bestBefore <= preparedAt) return showEditError('Pickup deadline must be after the prepared time.');
    if (bestBefore <= new Date()) return showEditError('Pickup deadline must be in the future.');

    const formData = new FormData();
    formData.append('foodName', document.getElementById('editFoodName').value.trim());
    formData.append('totalQuantity', quantity);
    // A disabled <select> is not submitted by forms, but we build the data by hand.
    formData.append('unit', document.getElementById('editUnit').value);
    formData.append('zoneId', document.getElementById('editZone').value);
    formData.append('addressDetail', document.getElementById('editAddressDetail').value.trim());
    formData.append('preparedAt', preparedAt.toISOString());
    formData.append('bestBeforeAt', bestBefore.toISOString());
    const photo = document.getElementById('editPhoto').files[0];
    if (photo) formData.append('photo', photo);
    if (document.getElementById('editRemovePhoto').checked) formData.append('removePhoto', 'true');

    try {
        pageListing = await updateListingRequest(pageListing.id, formData);
    } catch (err) {
        return showEditError(err.message);
    }

    document.getElementById('editCard').classList.add('d-none');
    await renderAll();
}
