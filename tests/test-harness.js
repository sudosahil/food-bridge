/*
 * Test harness for Surplus Food Bridge's browser-side pure logic.
 * Stubs just enough of the browser (a no-op DOM) to load js/common.js
 * directly in Node and exercise its pure functions with real assertions.
 * Server behaviour (auth, admin, photos, simultaneous claims) is covered
 * by tests/api.test.js; UI behaviour by the manual test-case table in the
 * project documentation.
 *
 * Run with: node tests/test-harness.js
 */
const fs = require('fs');
const path = require('path');

// ---- minimal browser stubs ----
global.document = {
    addEventListener: () => {},
    body: { dataset: {} },
    getElementById: () => null,
    querySelectorAll: () => []
};
global.window = { addEventListener: () => {} };

const code = fs.readFileSync(path.join(__dirname, '../js/common.js'), 'utf8');
eval(code);

// ---- tiny assertion helpers ----
let pass = 0, fail = 0;
function check(label, condition, detail) {
    if (condition) {
        pass++;
        console.log('PASS  ' + label);
    } else {
        fail++;
        console.log('FAIL  ' + label + (detail ? '  -> ' + detail : ''));
    }
}

function listing(overrides) {
    return Object.assign({
        id: 'l1', foodName: 'Item', totalQuantity: 10, unit: 'kg', claimedQuantity: 0,
        donorUsername: 'donor', status: 'available', claims: [], photoUrl: null,
        preparedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        bestBeforeAt: new Date(Date.now() + 5 * 3600 * 1000).toISOString()
    }, overrides);
}

async function run() {
    console.log('================ FRESHNESS LOGIC (getFreshnessInfo) ================');
    const hour = 3600 * 1000;
    const now = Date.now();
    const freshItem = { preparedAt: new Date(now - 1 * hour).toISOString(), bestBeforeAt: new Date(now + 5 * hour).toISOString() };
    const soonItem = { preparedAt: new Date(now - 5 * hour).toISOString(), bestBeforeAt: new Date(now + 1 * hour).toISOString() };
    const expiredItem = { preparedAt: new Date(now - 20 * hour).toISOString(), bestBeforeAt: new Date(now - 1 * hour).toISOString() };

    check('Listing with >50% shelf life left is Fresh', getFreshnessInfo(freshItem).label === 'Fresh', getFreshnessInfo(freshItem).label);
    check('Listing with <50% shelf life left is Use Soon', getFreshnessInfo(soonItem).label === 'Use Soon', getFreshnessInfo(soonItem).label);
    check('Listing past bestBeforeAt is Expired', getFreshnessInfo(expiredItem).label === 'Expired', getFreshnessInfo(expiredItem).label);

    console.log('\n================ BADGE LOGIC (getListingBadges) - no contradictions ================');
    const b1 = getListingBadges({ ...expiredItem, status: 'available' }).map(b => b.label);
    const b2 = getListingBadges({ ...expiredItem, status: 'partially_claimed' }).map(b => b.label);
    const b3 = getListingBadges({ ...freshItem, status: 'available' }).map(b => b.label);
    check('Expired + available shows only "Expired" (no "Available")', JSON.stringify(b1) === JSON.stringify(['Expired']), JSON.stringify(b1));
    check('Expired + partially claimed shows "Expired"+"Partially Claimed"', JSON.stringify(b2) === JSON.stringify(['Expired', 'Partially Claimed']), JSON.stringify(b2));
    check('Fresh + available shows "Available"+"Fresh"', JSON.stringify(b3) === JSON.stringify(['Available', 'Fresh']), JSON.stringify(b3));

    console.log('\n================ QUANTITY MATH (remainingQuantity) ================');
    check('remainingQuantity(10 total, 4 claimed) = 6', remainingQuantity({ totalQuantity: 10, claimedQuantity: 4 }) === 6);
    check('remainingQuantity never goes negative', remainingQuantity({ totalQuantity: 5, claimedQuantity: 9 }) === 0);

    console.log('\n================ STATS AGGREGATION ================');
    const claim = (ngo, q) => ({ ngoUsername: ngo, ngoName: ngo, quantity: q, claimedAt: new Date().toISOString() });
    const listings = [
        listing({ id: 'a', status: 'partially_claimed', claimedQuantity: 4, claims: [claim('ngo', 4)] }),
        listing({ id: 'b', status: 'claimed', claimedQuantity: 10, claims: [claim('ngo', 6), claim('foodrescue', 4)] }),
        listing({ id: 'c', donorUsername: 'other' })
    ];
    const donorStats = computeDonorStats(listings, 'donor');
    check('computeDonorStats counts only that donor\'s listings', donorStats.totalPosted === 2, donorStats.totalPosted);
    check('computeDonorStats sums claimed units', donorStats.totalRescued === 14, donorStats.totalRescued);
    check('computeDonorStats counts distinct NGOs served', donorStats.ngoServed === 2, donorStats.ngoServed);
    check('computeDonorStats splits active vs completed', donorStats.activeCount === 1 && donorStats.completedCount === 1);

    const ngoStats = computeNgoStats(listings, 'ngo');
    check('computeNgoStats counts this NGO\'s claims and units', ngoStats.myClaimCount === 2 && ngoStats.myQuantity === 10, JSON.stringify(ngoStats));

    const reviews = [
        { donorUsername: 'donor', rating: 5 }, { donorUsername: 'donor', rating: 4 }, { donorUsername: 'other', rating: 1 }
    ];
    const rating = computeDonorRating(reviews, 'donor');
    check('computeDonorRating averages only that donor\'s reviews', rating.avg === 4.5 && rating.count === 2, JSON.stringify(rating));
    check('computeDonorRating with no reviews is 0/0', computeDonorRating([], 'x').count === 0);

    console.log('\n================ SECURITY: escapeHtml ================');
    const malicious = '<script>alert(1)</script>"quoted"';
    const escaped = escapeHtml(malicious);
    check('escapeHtml neutralizes < > and quotes', !escaped.includes('<script>') && escaped.includes('&lt;script&gt;'), escaped);

    console.log('\n================ LISTING PHOTO MARKUP ================');
    const withPhoto = renderListingPhotoHtml(listing({ photoUrl: '/uploads/abc.png', foodName: 'Rice' }));
    check('Photo present renders an <img> with alt text', withPhoto.startsWith('<img') && withPhoto.includes('alt="Photo of Rice"'), withPhoto);
    const noPhoto = renderListingPhotoHtml(listing());
    check('No photo renders the placeholder block', noPhoto.includes('listing-photo-empty') && !noPhoto.includes('<img'), noPhoto);
    const evil = renderListingPhotoHtml(listing({ photoUrl: '"><script>x</script>', foodName: '<b>' }));
    check('Photo markup escapes url and name', !evil.includes('<script>') && !evil.includes('<b>'), evil);

    console.log('\n================ SHELF-LIFE GAUGE ================');
    const half = { preparedAt: new Date(now - 2 * hour).toISOString(), bestBeforeAt: new Date(now + 2 * hour).toISOString() };
    check('shelfLifeRatio is ~0.5 halfway through the window', Math.abs(shelfLifeRatio(half) - 0.5) < 0.01, shelfLifeRatio(half));
    check('shelfLifeRatio is 0 once expired', shelfLifeRatio(expiredItem) === 0);
    check('shelfLifeRatio never exceeds 1', shelfLifeRatio({ preparedAt: new Date(now + hour).toISOString(), bestBeforeAt: new Date(now + 2 * hour).toISOString() }) <= 1);
    check('Fresh listing gets the green gauge', renderShelfLifeHtml(freshItem).includes('shelf-fresh'));
    check('Use-soon listing gets the amber gauge', renderShelfLifeHtml(soonItem).includes('shelf-soon'));
    check('Expired listing gets the red gauge at 0%', renderShelfLifeHtml(expiredItem).includes('shelf-expired') && renderShelfLifeHtml(expiredItem).includes('width:0%'));
    check('Media block carries photo and chips', renderListingMediaHtml(listing()).includes('listing-chips') && renderListingMediaHtml(listing()).includes('listing-photo'));

    console.log('\n================ RELATIVE TIME + TRANSACTION CHIPS ================');
    const at = Date.parse('2026-10-20T12:00:00Z');
    check('formatRelativeTime: under a minute is "just now"', formatRelativeTime('2026-10-20T11:59:40Z', at) === 'just now');
    check('formatRelativeTime: minutes', formatRelativeTime('2026-10-20T11:55:00Z', at) === '5 min ago');
    check('formatRelativeTime: hours', formatRelativeTime('2026-10-20T09:00:00Z', at) === '3 h ago');
    check('Known transaction type renders its label', renderTransactionTypeHtml('claim').includes('>Claim<'));
    check('Unknown transaction type falls back safely', renderTransactionTypeHtml('<x>').includes('&lt;x&gt;'));
    check('Verification chip shows Pending for pending accounts', renderVerificationChipHtml('pending').includes('Pending'));
    check('Verification chip shows Unapproved', renderVerificationChipHtml('unapproved').includes('Unapproved'));

    console.log('\n================ ROLE ROUTING ================');
    check('admin role lands on admin.html', dashboardUrlForRole('admin') === 'admin.html');
    check('donor and ngo routes unchanged', dashboardUrlForRole('donor') === 'donor.html' && dashboardUrlForRole('ngo') === 'ngo.html');

    console.log('\n================ COUNTDOWN FORMATTING ================');
    check('formatCountdown(0) reports pickup window closed', formatCountdown(0) === 'Pickup window closed');
    check('formatCountdown(90 min) formats as "1h 30m left for pickup"', formatCountdown(90 * 60 * 1000) === '1h 30m left for pickup', formatCountdown(90 * 60 * 1000));
    check('formatCountdown(45 min) formats as "45m left for pickup"', formatCountdown(45 * 60 * 1000) === '45m left for pickup', formatCountdown(45 * 60 * 1000));

    console.log('\n================ PHONE VALIDATION ================');
    check('isValidPhone accepts exactly 10 digits', isValidPhone('9821000101'));
    check('isValidPhone rejects short, long and non-digit input', !isValidPhone('98210001') && !isValidPhone('98210001011') && !isValidPhone('98210a0101'));

    console.log('\n=======================================================');
    console.log('TOTAL: ' + (pass + fail) + '   PASS: ' + pass + '   FAIL: ' + fail);
    process.exit(fail > 0 ? 1 : 0);
}

run();
