/*
 * Surplus Food Bridge - js/transactions.js
 * Logic for transactions.html: loads the latest transactions, then keeps
 * the table live through a Server-Sent Events stream (the browser's
 * EventSource reconnects on its own if the connection drops).
 * Admins see everything; donors and NGOs see only what involves them.
 */

const PAGE_SIZE = 50;
const MAX_ROWS = 500;

let transactions = [];
let hasMore = false;
let currentTxUser = null;

// ---------- ENTRY POINT ----------
document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'transactions') return;
    initTransactionsPage();
});

async function initTransactionsPage() {
    const user = await requireAnyLogin();
    if (!user) return;
    currentTxUser = user;

    setupNavbar(user, '<a href="' + dashboardUrlForRole(user.role) + '">Dashboard</a>');
    document.getElementById('txSubtitle').textContent = user.role === 'admin'
        ? 'Every claim, post, edit and account decision on the platform, newest first.'
        : 'Your claims, posts, edits and account updates, newest first.';

    populateTypeFilter();
    document.getElementById('txTypeFilter').addEventListener('change', renderRows);
    document.getElementById('txSearch').addEventListener('input', renderRows);
    document.getElementById('txLoadMore').addEventListener('click', function (event) {
        runOnce(event.currentTarget, loadOlder);
    });

    await loadLatest();
    openLiveStream();

    // Keep "5 min ago" honest between events.
    setInterval(refreshRelativeTimes, 30000);
}

function populateTypeFilter() {
    const select = document.getElementById('txTypeFilter');
    Object.keys(TRANSACTION_TYPES).forEach(function (type) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = TRANSACTION_TYPES[type].label;
        select.appendChild(option);
    });
}

// ---------- LOADING ----------
async function loadLatest() {
    try {
        const rows = await fetchTransactions({ limit: PAGE_SIZE });
        transactions = rows;
        hasMore = rows.length === PAGE_SIZE;
        renderRows();
    } catch (err) {
        document.getElementById('txBody').innerHTML = '<tr><td colspan="5" class="empty-state">' + escapeHtml(err.message) + '</td></tr>';
    }
}

async function loadOlder() {
    if (transactions.length === 0) return;
    const oldest = transactions[transactions.length - 1].createdAt;
    const rows = await fetchTransactions({ limit: PAGE_SIZE, before: oldest });
    const known = new Set(transactions.map(function (t) { return t.id; }));
    transactions = transactions.concat(rows.filter(function (t) { return !known.has(t.id); }));
    hasMore = rows.length === PAGE_SIZE;
    renderRows();
}

// ---------- LIVE STREAM ----------
function openLiveStream() {
    const source = new EventSource('/api/transactions/stream');

    source.addEventListener('open', function () {
        setLiveStatus('live', 'Live');
        // The stream does not replay what happened while it was down.
        if (hasConnectedBefore) mergeLatest();
        hasConnectedBefore = true;
    });
    source.addEventListener('transaction', function (event) {
        addLiveTransaction(JSON.parse(event.data));
    });
    source.addEventListener('error', function () {
        // CLOSED means the browser gave up (for example the session ended).
        if (source.readyState === EventSource.CLOSED) setLiveStatus('closed', 'Disconnected. Reload the page.');
        else setLiveStatus('connecting', 'Reconnecting');
    });
}

function setLiveStatus(state, text) {
    document.getElementById('liveStatus').className = 'live-status live-' + state;
    document.getElementById('liveStatusText').textContent = text;
}

let hasConnectedBefore = false;

async function mergeLatest() {
    try {
        const rows = await fetchTransactions({ limit: PAGE_SIZE });
        const known = new Set(transactions.map(function (t) { return t.id; }));
        const missed = rows.filter(function (t) { return !known.has(t.id); });
        if (missed.length === 0) return;
        missed.forEach(function (t) { t.isNew = true; });
        transactions = missed.concat(transactions).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        renderRows();
    } catch (err) {
        // The next reconnect or page load will catch up.
    }
}

function addLiveTransaction(tx) {
    if (transactions.some(function (t) { return t.id === tx.id; })) return;
    tx.isNew = true;
    transactions.unshift(tx);
    if (transactions.length > MAX_ROWS) transactions.length = MAX_ROWS;
    renderRows();
}

// ---------- RENDERING ----------
function matchesFilters(tx) {
    const type = document.getElementById('txTypeFilter').value;
    const query = document.getElementById('txSearch').value.trim().toLowerCase();
    if (type && tx.type !== type) return false;
    if (query && (tx.summary + ' ' + (tx.listingName || '')).toLowerCase().indexOf(query) === -1) return false;
    return true;
}

function renderRows() {
    const body = document.getElementById('txBody');
    const rows = transactions.filter(matchesFilters);

    if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="empty-state">' +
            (transactions.length === 0
                ? 'No transactions yet. Claims, posts and edits will appear here the moment they happen.'
                : 'No transactions match these filters.') + '</td></tr>';
    } else {
        body.innerHTML = rows.map(buildRowHtml).join('');
    }
    document.getElementById('txLoadMore').classList.toggle('d-none', !hasMore);
    // The highlight is a one-time cue for a row that just arrived.
    transactions.forEach(function (t) { delete t.isNew; });
}

function buildRowHtml(tx) {
    const listingCell = tx.listingId && tx.type !== 'listing_removed'
        ? '<a class="listing-donor-link" href="listing.html?id=' + encodeURIComponent(tx.listingId) + '">' + escapeHtml(tx.listingName || 'Open') + '</a>'
        : escapeHtml(tx.listingName || '-');
    const quantity = tx.quantity !== undefined && tx.quantity !== null ? tx.quantity + ' ' + escapeHtml(tx.unit || '') : '-';

    return '<tr class="' + (tx.isNew ? 'tx-row-new' : '') + '">' +
        '<td class="text-nowrap"><span data-time="' + escapeHtml(tx.createdAt) + '">' + formatRelativeTime(tx.createdAt) + '</span>' +
            '<span class="listing-meta d-block">' + formatDateTime(tx.createdAt) + '</span></td>' +
        '<td>' + renderTransactionTypeHtml(tx.type) + '</td>' +
        '<td>' + escapeHtml(tx.summary) + '</td>' +
        '<td>' + listingCell + '</td>' +
        '<td class="text-end text-nowrap">' + quantity + '</td>' +
    '</tr>';
}

function refreshRelativeTimes() {
    document.querySelectorAll('[data-time]').forEach(function (el) {
        el.textContent = formatRelativeTime(el.getAttribute('data-time'));
    });
}
