/*
 * API integration tests: real Express app, real MongoDB (database
 * "sfb_test", wiped before the run). Covers auth/roles, the admin role,
 * photo uploads, and above all the simultaneous-claim behaviour.
 *
 * Run with: npm run test:api   (needs mongod on localhost:27017)
 */
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'sfb-test-uploads');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');

const config = require('../server/src/config');
const { connectDb } = require('../server/src/db');
const { createApp } = require('../server/src/app');
const { ensureSeeded } = require('../server/src/seed/seedData');
const User = require('../server/src/models/User');

const app = createApp();
const HOUR = 3600 * 1000;

// Smallest valid files for each type, plus a fake image (text with a .png name).
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const NOT_AN_IMAGE = Buffer.from('<script>alert(1)</script>');

async function loginAgent(username, password) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ username, password });
    assert.equal(res.status, 200, 'login failed for ' + username + ': ' + JSON.stringify(res.body));
    return agent;
}

// Registers through the API, then (unless told otherwise) approves the new
// account straight in the database so tests can act as that user.
async function registerUser(body, options) {
    const res = await request(app).post('/api/auth/register').send(Object.assign({ registrationNumber: 'REG-12345' }, body));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    if (!options || options.approve !== false) {
        await User.updateOne({ username: body.username }, { verificationStatus: 'approved' });
    }
    return res.body.data;
}

function listingFields(overrides) {
    return Object.assign({
        foodName: 'Test Biryani',
        totalQuantity: '10',
        unit: 'boxes',
        zoneId: 'colaba',
        addressDetail: 'Back door',
        preparedAt: new Date(Date.now() - HOUR).toISOString(),
        bestBeforeAt: new Date(Date.now() + 5 * HOUR).toISOString()
    }, overrides);
}

async function postListing(donorAgent, overrides) {
    const res = await donorAgent.post('/api/listings').send(listingFields(overrides));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data;
}

let donor;
let ngoAgents = [];
let admin;

before(async () => {
    await connectDb('mongodb://127.0.0.1:27017/sfb_test');
    await mongoose.connection.dropDatabase();
    await mongoose.connection.syncIndexes();
    await ensureSeeded();

    donor = await loginAgent('donor', '1234');
    admin = await loginAgent(config.adminUsername, config.adminPassword);

    // 12 extra NGOs so we can fire many claims at once.
    for (let i = 0; i < 12; i++) {
        await registerUser({
            role: 'ngo', name: 'Load NGO ' + i, username: 'loadngo' + i, password: 'secret12',
            zoneId: 'powai', phone: '9000000' + String(100 + i), address: 'Somewhere ' + i
        });
        ngoAgents.push(await loginAgent('loadngo' + i, 'secret12'));
    }
});

after(async () => {
    fs.rmSync(config.uploadDir, { recursive: true, force: true });
    await mongoose.disconnect();
});

describe('seed data', () => {
    it('seeds 6 demo users, 14 listings, 7 reviews and one admin', async () => {
        const res = await donor.get('/api/listings');
        assert.equal(res.status, 200);
        assert.ok(res.body.data.length >= 14);
        assert.equal(await User.countDocuments({ role: 'admin' }), 1);
        const reviews = await donor.get('/api/reviews');
        assert.equal(reviews.body.data.length, 7);
    });
});

describe('auth', () => {
    it('rejects bad credentials with a generic message', async () => {
        const res = await request(app).post('/api/auth/login').send({ username: 'donor', password: 'wrong' });
        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    });

    it('never returns the password hash and sets an httpOnly cookie', async () => {
        const res = await request(app).post('/api/auth/login').send({ username: 'donor', password: '1234' });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.passwordHash, undefined);
        assert.equal(res.body.data.role, 'donor');
        assert.match(res.headers['set-cookie'][0], /HttpOnly/);
    });

    it('requires login for protected routes', async () => {
        const res = await request(app).get('/api/listings');
        assert.equal(res.status, 401);
        assert.equal(res.body.data, null);
    });

    it('cannot self-register as admin', async () => {
        const res = await request(app).post('/api/auth/register').send({
            role: 'admin', name: 'Evil', username: 'evil', password: 'secret12',
            zoneId: 'colaba', phone: '9111111111', address: 'x', registrationNumber: 'REG-12345'
        });
        assert.equal(res.status, 422);
    });

    it('rejects duplicate usernames and short passwords', async () => {
        const body = { role: 'ngo', name: 'Dup', username: 'ngo', password: 'secret12', zoneId: 'colaba', phone: '9111111111', address: 'x', registrationNumber: 'REG-12345' };
        assert.equal((await request(app).post('/api/auth/register').send(body)).status, 409);
        assert.equal((await request(app).post('/api/auth/register').send({ ...body, username: 'fresh', password: '123' })).status, 422);
    });
});

describe('admin role', () => {
    it('blocks non-admins from admin routes', async () => {
        assert.equal((await donor.get('/api/admin/stats')).status, 403);
        assert.equal((await ngoAgents[0].get('/api/admin/users')).status, 403);
    });

    it('lets an admin read stats and users', async () => {
        const stats = await admin.get('/api/admin/stats');
        assert.equal(stats.status, 200);
        assert.ok(stats.body.data.donors >= 3);
        const users = await admin.get('/api/admin/users');
        assert.ok(users.body.data.length >= 10);
        assert.ok(users.body.data.every(u => u.passwordHash === undefined));
    });

    it('suspending a user blocks login and hides their listings; reactivating restores both', async () => {
        await registerUser({ role: 'donor', name: 'Temp Donor', username: 'tempdonor', password: 'secret12', zoneId: 'kurla', phone: '9222222222', address: 'x' });
        const tempAgent = await loginAgent('tempdonor', 'secret12');
        const listing = await postListing(tempAgent, { foodName: 'Temp Soup' });
        const target = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'tempdonor');

        assert.equal((await admin.patch('/api/admin/users/' + target.id).send({ active: false })).status, 200);

        const login = await request(app).post('/api/auth/login').send({ username: 'tempdonor', password: 'secret12' });
        assert.equal(login.status, 403);
        assert.equal((await tempAgent.get('/api/auth/me')).status, 403, 'existing session is cut off immediately');

        const feed = await ngoAgents[0].get('/api/listings');
        assert.ok(!feed.body.data.some(l => l.id === listing.id), 'suspended donor listings are hidden from NGOs');

        await admin.patch('/api/admin/users/' + target.id).send({ active: true });
        const feedAfter = await ngoAgents[0].get('/api/listings');
        assert.ok(feedAfter.body.data.some(l => l.id === listing.id));
    });

    it('admin cannot modify admins or themselves', async () => {
        const me = (await admin.get('/api/auth/me')).body.data;
        assert.equal((await admin.patch('/api/admin/users/' + me.id).send({ active: false })).status, 403);
        assert.equal((await admin.delete('/api/admin/users/' + me.id)).status, 403);
    });

    it('deleting a donor removes their listings', async () => {
        await registerUser({ role: 'donor', name: 'Gone Donor', username: 'gonedonor', password: 'secret12', zoneId: 'kurla', phone: '9333333333', address: 'x' });
        const agent = await loginAgent('gonedonor', 'secret12');
        const listing = await postListing(agent);
        const target = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'gonedonor');

        assert.equal((await admin.delete('/api/admin/users/' + target.id)).status, 200);
        const feed = await admin.get('/api/listings');
        assert.ok(!feed.body.data.some(l => l.id === listing.id));
    });

    it('admin can remove a listing; NGOs cannot', async () => {
        const listing = await postListing(donor);
        assert.equal((await ngoAgents[0].delete('/api/listings/' + listing.id)).status, 403);
        assert.equal((await admin.delete('/api/listings/' + listing.id)).status, 200);
        assert.equal((await admin.delete('/api/listings/' + listing.id)).status, 404);
    });

    it('a donor can delete their own unclaimed listing, but not someone else\'s', async () => {
        const other = await loginAgent('greenplate', '1234');
        const listing = await postListing(donor);
        const refused = await other.delete('/api/listings/' + listing.id);
        assert.equal(refused.status, 404);
        assert.equal((await donor.get('/api/listings/' + listing.id)).status, 200, 'still there');
        assert.equal((await donor.delete('/api/listings/' + listing.id)).status, 200);
        assert.equal((await donor.get('/api/listings/' + listing.id)).status, 404);
    });

    it('a donor cannot delete a listing once an NGO has claimed from it', async () => {
        const listing = await postListing(donor);
        await ngoAgents[0].post('/api/listings/' + listing.id + '/claim').send({ quantity: 1 });
        const res = await donor.delete('/api/listings/' + listing.id);
        assert.equal(res.status, 409);
        assert.equal(res.body.error.code, 'HAS_CLAIMS');
        assert.equal((await admin.delete('/api/listings/' + listing.id)).status, 200, 'admin still can');
    });

    it('admin can delete a review', async () => {
        const reviews = (await admin.get('/api/reviews')).body.data;
        assert.equal((await admin.delete('/api/reviews/' + reviews[0].id)).status, 200);
        assert.equal((await admin.get('/api/reviews')).body.data.length, reviews.length - 1);
    });
});

describe('photo uploads', () => {
    it('stores a real image and serves it', async () => {
        const fields = listingFields({ foodName: 'Photo Item' });
        const req = donor.post('/api/listings');
        Object.keys(fields).forEach(k => req.field(k, fields[k]));
        const res = await req.attach('photo', PNG_BYTES, { filename: 'food.png', contentType: 'image/png' });

        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.match(res.body.data.photoUrl, /^\/uploads\/[0-9a-f-]+\.png$/);
        const file = await request(app).get(res.body.data.photoUrl);
        assert.equal(file.status, 200);
        assert.match(file.headers['content-type'], /image\/png/);
    });

    it('rejects a non-image disguised as .png and writes nothing', async () => {
        const before = fs.existsSync(config.uploadDir) ? fs.readdirSync(config.uploadDir).length : 0;
        const fields = listingFields({ foodName: 'Fake Photo' });
        const req = donor.post('/api/listings');
        Object.keys(fields).forEach(k => req.field(k, fields[k]));
        const res = await req.attach('photo', NOT_AN_IMAGE, { filename: 'evil.png', contentType: 'image/png' });

        assert.equal(res.status, 422);
        assert.equal(res.body.error.code, 'INVALID_UPLOAD');
        const after = fs.existsSync(config.uploadDir) ? fs.readdirSync(config.uploadDir).length : 0;
        assert.equal(after, before);
    });

    it('rejects oversized photos', async () => {
        const big = Buffer.concat([PNG_BYTES, Buffer.alloc(config.maxPhotoBytes)]);
        const fields = listingFields();
        const req = donor.post('/api/listings');
        Object.keys(fields).forEach(k => req.field(k, fields[k]));
        const res = await req.attach('photo', big, { filename: 'big.png', contentType: 'image/png' });
        assert.equal(res.status, 422);
    });

    it('allows listings without a photo (photoUrl is null)', async () => {
        const listing = await postListing(donor);
        assert.equal(listing.photoUrl, null);
    });

    it('deletes the photo file when an admin removes the listing', async () => {
        const fields = listingFields();
        const req = donor.post('/api/listings');
        Object.keys(fields).forEach(k => req.field(k, fields[k]));
        const created = (await req.attach('photo', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' })).body.data;
        const onDisk = path.join(config.uploadDir, path.basename(created.photoUrl));
        assert.ok(fs.existsSync(onDisk));
        await admin.delete('/api/listings/' + created.id);
        assert.ok(!fs.existsSync(onDisk));
    });
});

describe('listing rules', () => {
    it('only donors can post; NGOs get 403', async () => {
        const res = await ngoAgents[0].post('/api/listings').send(listingFields());
        assert.equal(res.status, 403);
    });

    it('validates deadline and quantity', async () => {
        const past = await donor.post('/api/listings').send(listingFields({ bestBeforeAt: new Date(Date.now() - HOUR).toISOString() }));
        assert.equal(past.status, 422);
        const zero = await donor.post('/api/listings').send(listingFields({ totalQuantity: '0' }));
        assert.equal(zero.status, 422);
    });
});

describe('simultaneous claims', () => {
    it('20 parallel claims of 1 unit on a 5-unit listing: exactly 5 win, never over-claimed', async () => {
        const listing = await postListing(donor, { totalQuantity: '5', unit: 'kg' });
        // 12 NGOs; some fire twice so duplicates race as well.
        const attempts = ngoAgents.concat(ngoAgents.slice(0, 8));
        const results = await Promise.all(attempts.map(a => a.post('/api/listings/' + listing.id + '/claim').send({ quantity: 1 })));

        const ok = results.filter(r => r.status === 200).length;
        const conflicts = results.filter(r => r.status === 409).length;
        assert.equal(ok, 5, 'statuses: ' + results.map(r => r.status).join(','));
        assert.equal(conflicts, 15);

        const final = (await donor.get('/api/listings')).body.data.find(l => l.id === listing.id);
        assert.equal(final.claimedQuantity, 5);
        assert.equal(final.status, 'claimed');
        assert.equal(final.claims.length, 5);
        assert.equal(new Set(final.claims.map(c => c.ngoUsername)).size, 5, 'no NGO recorded twice');
    });

    it('the same NGO double-clicking claims once', async () => {
        const listing = await postListing(donor, { totalQuantity: '10' });
        const results = await Promise.all([1, 2, 3, 4, 5].map(() =>
            ngoAgents[0].post('/api/listings/' + listing.id + '/claim').send({ quantity: 2 })));

        assert.equal(results.filter(r => r.status === 200).length, 1);
        const rejected = results.find(r => r.status === 409);
        assert.equal(rejected.body.error.code, 'ALREADY_CLAIMED');
        const final = (await donor.get('/api/listings')).body.data.find(l => l.id === listing.id);
        assert.equal(final.claimedQuantity, 2);
    });

    it('two NGOs racing for more than what is left: totals stay within the posted amount', async () => {
        const listing = await postListing(donor, { totalQuantity: '10' });
        const [a, b] = await Promise.all([
            ngoAgents[1].post('/api/listings/' + listing.id + '/claim').send({ quantity: 7 }),
            ngoAgents[2].post('/api/listings/' + listing.id + '/claim').send({ quantity: 7 })
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const loser = a.status === 409 ? a : b;
        assert.equal(loser.body.error.code, 'INSUFFICIENT_QUANTITY');
        assert.match(loser.body.error.message, /Only 3 /);
    });

    it('partial claims accumulate and flip status correctly', async () => {
        const listing = await postListing(donor, { totalQuantity: '10' });
        const first = await ngoAgents[3].post('/api/listings/' + listing.id + '/claim').send({ quantity: 4 });
        assert.equal(first.body.data.status, 'partially_claimed');
        assert.equal(first.body.data.claimedQuantity, 4);
        const second = await ngoAgents[4].post('/api/listings/' + listing.id + '/claim').send({ quantity: 6 });
        assert.equal(second.body.data.status, 'claimed');
    });

    it('decimal quantities do not drift (0.1 + 0.2 fills a 0.3 listing)', async () => {
        const listing = await postListing(donor, { totalQuantity: '0.3' });
        const a = await ngoAgents[5].post('/api/listings/' + listing.id + '/claim').send({ quantity: 0.1 });
        const b = await ngoAgents[6].post('/api/listings/' + listing.id + '/claim').send({ quantity: 0.2 });
        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        assert.equal(b.body.data.status, 'claimed');
        assert.equal(b.body.data.claimedQuantity, 0.3);
    });

    it('rejects expired listings, bad ids, zero quantity, and donors claiming', async () => {
        const expired = (await donor.get('/api/listings')).body.data.find(l => l.foodName === 'Leftover Sandwich Platter');
        const res = await ngoAgents[0].post('/api/listings/' + expired.id + '/claim').send({ quantity: 1 });
        assert.equal(res.status, 409);
        assert.equal(res.body.error.code, 'EXPIRED');

        assert.equal((await ngoAgents[0].post('/api/listings/not-an-id/claim').send({ quantity: 1 })).status, 404);
        const live = await postListing(donor);
        assert.equal((await ngoAgents[0].post('/api/listings/' + live.id + '/claim').send({ quantity: 0 })).status, 422);
        assert.equal((await donor.post('/api/listings/' + live.id + '/claim').send({ quantity: 1 })).status, 403);
    });
});

describe('reviews', () => {
    it('only an NGO that claimed from the listing can review it, once', async () => {
        const listing = await postListing(donor, { totalQuantity: '4' });
        await ngoAgents[7].post('/api/listings/' + listing.id + '/claim').send({ quantity: 2 });

        const stranger = await ngoAgents[8].post('/api/reviews').send({ listingId: listing.id, rating: 5, comment: 'nice' });
        assert.equal(stranger.status, 403);

        const ok = await ngoAgents[7].post('/api/reviews').send({ listingId: listing.id, rating: 5, comment: 'great' });
        assert.equal(ok.status, 201);
        assert.equal(ok.body.data.donorUsername, 'donor', 'donor comes from the listing, not the client');

        const dup = await ngoAgents[7].post('/api/reviews').send({ listingId: listing.id, rating: 1, comment: 'again' });
        assert.equal(dup.status, 409);
    });
});

describe('profile + donor lookup', () => {
    it('donor can edit own profile; validation enforces 10-digit phone', async () => {
        const bad = await donor.patch('/api/users/me').send({ phone: '123', zoneId: 'colaba', address: 'x' });
        assert.equal(bad.status, 422);
        const good = await donor.patch('/api/users/me').send({ phone: '9821000101', zoneId: 'colaba', address: 'Colaba Causeway', description: 'Updated' });
        assert.equal(good.status, 200);
        assert.equal(good.body.data.description, 'Updated');
    });

    it('searches donors by name without treating input as a regex', async () => {
        const res = await ngoAgents[0].get('/api/users/donors').query({ search: 'bakery' });
        assert.equal(res.body.data.length, 1);
        const weird = await ngoAgents[0].get('/api/users/donors').query({ search: '.*' });
        assert.equal(weird.status, 200);
        assert.equal(weird.body.data.length, 0);
    });
});

describe('NGO and donor verification', () => {
    it('new accounts start as pending and cannot post, claim or review until approved', async () => {
        await registerUser({ role: 'ngo', name: 'Newcomer NGO', username: 'newngo', password: 'secret12', zoneId: 'bandra', phone: '9444444444', address: 'x' }, { approve: false });
        await registerUser({ role: 'donor', name: 'Newcomer Cafe', username: 'newcafe', password: 'secret12', zoneId: 'bandra', phone: '9555555555', address: 'x' }, { approve: false });
        const ngo = await loginAgent('newngo', 'secret12');
        const cafe = await loginAgent('newcafe', 'secret12');

        assert.equal((await ngo.get('/api/auth/me')).body.data.verificationStatus, 'pending');
        const live = await postListing(donor);

        const claim = await ngo.post('/api/listings/' + live.id + '/claim').send({ quantity: 1 });
        assert.equal(claim.status, 403);
        assert.equal(claim.body.error.code, 'NOT_APPROVED');
        const post = await cafe.post('/api/listings').send(listingFields());
        assert.equal(post.status, 403);
        assert.equal(post.body.error.code, 'NOT_APPROVED');
        assert.equal((await ngo.get('/api/listings')).status, 200, 'browsing is still allowed');
    });

    it('requires a registration number at sign-up', async () => {
        const res = await request(app).post('/api/auth/register').send({
            role: 'ngo', name: 'No Number', username: 'nonumber', password: 'secret12', zoneId: 'colaba', phone: '9666666666', address: 'x'
        });
        assert.equal(res.status, 422);
    });

    it('admin approves, then the NGO can claim; unapproving blocks it again', async () => {
        const target = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'newngo');
        assert.equal(target.registrationNumber, 'REG-12345', 'admin sees the verification details');
        const ngo = await loginAgent('newngo', 'secret12');
        const live = await postListing(donor, { totalQuantity: '6' });

        assert.equal((await admin.patch('/api/admin/users/' + target.id + '/verification').send({ status: 'approved' })).status, 200);
        assert.equal((await ngo.post('/api/listings/' + live.id + '/claim').send({ quantity: 2 })).status, 200);

        await admin.patch('/api/admin/users/' + target.id + '/verification').send({ status: 'unapproved' });
        const blocked = await ngo.post('/api/reviews').send({ listingId: live.id, rating: 5, comment: 'ok' });
        assert.equal(blocked.status, 403);
        assert.match(blocked.body.error.message, /not approved/);
    });

    it('only admins can change verification, and it rejects bad statuses', async () => {
        const target = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'newcafe');
        assert.equal((await donor.patch('/api/admin/users/' + target.id + '/verification').send({ status: 'approved' })).status, 403);
        assert.equal((await admin.patch('/api/admin/users/' + target.id + '/verification').send({ status: 'pending' })).status, 422);
    });

    it('an unapproved donor\'s listings disappear from the feed; approving brings them back', async () => {
        const target = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'newcafe');
        await admin.patch('/api/admin/users/' + target.id + '/verification').send({ status: 'approved' });
        const cafe = await loginAgent('newcafe', 'secret12');
        const listing = await postListing(cafe, { foodName: 'Cafe Special' });
        assert.ok((await ngoAgents[0].get('/api/listings')).body.data.some(l => l.id === listing.id));

        await admin.patch('/api/admin/users/' + target.id + '/verification').send({ status: 'unapproved' });
        assert.ok(!(await ngoAgents[0].get('/api/listings')).body.data.some(l => l.id === listing.id));
        assert.equal((await ngoAgents[0].get('/api/listings/' + listing.id)).status, 404);
        assert.equal((await cafe.get('/api/listings/' + listing.id)).status, 200, 'owner still sees their own listing');
        assert.equal((await ngoAgents[0].get('/api/users/donors/newcafe')).status, 404);
        assert.equal((await cafe.get('/api/users/donors/newcafe')).status, 200);
    });

    it('stats report pending approvals', async () => {
        await registerUser({ role: 'donor', name: 'Pending One', username: 'pendingone', password: 'secret12', zoneId: 'kurla', phone: '9777777777', address: 'x' }, { approve: false });
        const stats = (await admin.get('/api/admin/stats')).body.data;
        assert.ok(stats.pendingApprovals >= 1);
    });
});

describe('admin user profile (overview)', () => {
    it('returns an NGO\'s details, claimed listings, reviews and activity', async () => {
        const ngoUser = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'ngo');
        const res = await admin.get('/api/admin/users/' + ngoUser.id + '/overview');
        assert.equal(res.status, 200);
        assert.equal(res.body.data.user.username, 'ngo');
        assert.ok(res.body.data.listings.length >= 1);
        assert.ok(res.body.data.listings.every(l => l.claims.some(c => c.ngoUsername === 'ngo')));
        assert.ok(Array.isArray(res.body.data.reviews));
        assert.ok(Array.isArray(res.body.data.transactions));
    });

    it('returns a donor\'s listings and the reviews they received', async () => {
        const donorUser = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'donor');
        const res = await admin.get('/api/admin/users/' + donorUser.id + '/overview');
        assert.ok(res.body.data.listings.every(l => l.donorUsername === 'donor'));
        assert.ok(res.body.data.reviews.every(r => r.donorUsername === 'donor'));
    });

    it('is admin-only', async () => {
        const donorUser = (await admin.get('/api/admin/users')).body.data.find(u => u.username === 'donor');
        assert.equal((await ngoAgents[0].get('/api/admin/users/' + donorUser.id + '/overview')).status, 403);
    });
});

describe('editing listings', () => {
    it('a donor can open and edit their own listing', async () => {
        const listing = await postListing(donor, { foodName: 'Original Name', totalQuantity: '10' });
        const opened = await donor.get('/api/listings/' + listing.id);
        assert.equal(opened.body.data.foodName, 'Original Name');

        const fields = listingFields({ foodName: 'Renamed Item', totalQuantity: '12', addressDetail: 'New door' });
        const res = await donor.patch('/api/listings/' + listing.id).send(fields);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.foodName, 'Renamed Item');
        assert.equal(res.body.data.totalQuantity, 12);
        assert.equal(res.body.data.status, 'available');
    });

    it('other donors and NGOs cannot edit it; an admin can', async () => {
        const listing = await postListing(donor);
        const fields = listingFields({ foodName: 'Hijacked' });
        const other = await loginAgent('greenplate', '1234');
        assert.equal((await other.patch('/api/listings/' + listing.id).send(fields)).status, 404);
        assert.equal((await ngoAgents[0].patch('/api/listings/' + listing.id).send(fields)).status, 403);
        const byAdmin = await admin.patch('/api/listings/' + listing.id).send(listingFields({ foodName: 'Admin Fixed' }));
        assert.equal(byAdmin.status, 200);
        assert.equal(byAdmin.body.data.foodName, 'Admin Fixed');
        assert.equal(byAdmin.body.data.donorUsername, 'donor', 'ownership is unchanged');
    });

    it('cannot lower the total below what is already claimed, and locks once fully claimed', async () => {
        const listing = await postListing(donor, { totalQuantity: '10' });
        await ngoAgents[0].post('/api/listings/' + listing.id + '/claim').send({ quantity: 6 });

        const tooLow = await donor.patch('/api/listings/' + listing.id).send(listingFields({ totalQuantity: '5' }));
        assert.equal(tooLow.status, 409);
        assert.equal(tooLow.body.error.code, 'BELOW_CLAIMED');

        const exact = await donor.patch('/api/listings/' + listing.id).send(listingFields({ totalQuantity: '6' }));
        assert.equal(exact.body.data.status, 'claimed', 'total equal to claimed means fully claimed');
        assert.equal((await donor.patch('/api/listings/' + listing.id).send(listingFields())).status, 409, 'fully claimed listings are locked');
    });

    it('locks the unit once someone has claimed', async () => {
        const listing = await postListing(donor, { totalQuantity: '10', unit: 'kg' });
        await ngoAgents[1].post('/api/listings/' + listing.id + '/claim').send({ quantity: 2 });
        const res = await donor.patch('/api/listings/' + listing.id).send(listingFields({ unit: 'boxes', totalQuantity: '10' }));
        assert.equal(res.status, 409);
        assert.equal(res.body.error.code, 'UNIT_LOCKED');
    });

    it('replaces and removes photos on disk', async () => {
        const base = listingFields({ foodName: 'Photo Edit' });
        const create = donor.post('/api/listings');
        Object.keys(base).forEach(k => create.field(k, base[k]));
        const made = (await create.attach('photo', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' })).body.data;
        const oldFile = path.join(config.uploadDir, path.basename(made.photoUrl));
        assert.ok(fs.existsSync(oldFile));

        const replace = donor.patch('/api/listings/' + made.id);
        Object.keys(base).forEach(k => replace.field(k, base[k]));
        const replaced = (await replace.attach('photo', PNG_BYTES, { filename: 'b.png', contentType: 'image/png' })).body.data;
        assert.notEqual(replaced.photoUrl, made.photoUrl);
        assert.ok(!fs.existsSync(oldFile), 'old photo deleted');
        const newFile = path.join(config.uploadDir, path.basename(replaced.photoUrl));
        assert.ok(fs.existsSync(newFile));

        const remove = await donor.patch('/api/listings/' + made.id).send(Object.assign(listingFields({ foodName: 'Photo Edit' }), { removePhoto: 'true' }));
        assert.equal(remove.body.data.photoUrl, null);
        assert.ok(!fs.existsSync(newFile));
    });

    it('a bad photo on edit changes nothing', async () => {
        const listing = await postListing(donor, { foodName: 'Stays Same' });
        const req = donor.patch('/api/listings/' + listing.id);
        const fields = listingFields({ foodName: 'Should Not Apply' });
        Object.keys(fields).forEach(k => req.field(k, fields[k]));
        const res = await req.attach('photo', NOT_AN_IMAGE, { filename: 'x.png', contentType: 'image/png' });
        assert.equal(res.status, 422);
        assert.equal((await donor.get('/api/listings/' + listing.id)).body.data.foodName, 'Stays Same');
    });

    it('only logs what actually changed (times to the minute, nothing if untouched)', async () => {
        const listing = await postListing(donor, { foodName: 'Quiet Edit', totalQuantity: '10' });
        const base = listingFields({ foodName: 'Quiet Edit', totalQuantity: '10' });
        // The datetime picker drops seconds, so resend the same times truncated to the minute.
        base.preparedAt = new Date(Math.floor(new Date(listing.preparedAt).getTime() / 60000) * 60000).toISOString();
        base.bestBeforeAt = new Date(Math.floor(new Date(listing.bestBeforeAt).getTime() / 60000) * 60000).toISOString();
        base.addressDetail = listing.addressDetail;

        await donor.patch('/api/listings/' + listing.id).send(base);
        let rows = (await admin.get('/api/transactions').query({ listingId: listing.id })).body.data;
        assert.ok(!rows.some(t => t.type === 'listing_edited'), 'an unchanged save logs nothing');

        await donor.patch('/api/listings/' + listing.id).send(Object.assign({}, base, { addressDetail: 'Side gate' }));
        rows = (await admin.get('/api/transactions').query({ listingId: listing.id })).body.data;
        const edit = rows.find(t => t.type === 'listing_edited');
        assert.match(edit.summary, /\(pickup instructions\)/, edit.summary);
    });

    it('validates the same rules as posting', async () => {
        const listing = await postListing(donor);
        const past = await donor.patch('/api/listings/' + listing.id).send(listingFields({ bestBeforeAt: new Date(Date.now() - HOUR).toISOString() }));
        assert.equal(past.status, 422);
    });

    it('values starting with $ are stored as text, not evaluated', async () => {
        const listing = await postListing(donor, { totalQuantity: '5' });
        const res = await donor.patch('/api/listings/' + listing.id).send(listingFields({ foodName: '$claimedQuantity', addressDetail: '$totalQuantity', totalQuantity: '5' }));
        assert.equal(res.status, 200);
        assert.equal(res.body.data.foodName, '$claimedQuantity');
        assert.equal(res.body.data.addressDetail, '$totalQuantity');
    });

    it('an edit racing a claim never leaves claimed above the total', async () => {
        for (let round = 0; round < 5; round++) {
            const listing = await postListing(donor, { totalQuantity: '10' });
            const [claim, edit] = await Promise.all([
                ngoAgents[2].post('/api/listings/' + listing.id + '/claim').send({ quantity: 8 }),
                donor.patch('/api/listings/' + listing.id).send(listingFields({ totalQuantity: '5' }))
            ]);
            const final = (await donor.get('/api/listings/' + listing.id)).body.data;
            assert.ok(final.claimedQuantity <= final.totalQuantity, 'claimed ' + final.claimedQuantity + ' vs total ' + final.totalQuantity + ' (claim ' + claim.status + ', edit ' + edit.status + ')');
        }
    });

    it('claimant names starting with $ are stored as text', async () => {
        await registerUser({ role: 'ngo', name: '$totalQuantity Relief', username: 'dollarngo', password: 'secret12', zoneId: 'powai', phone: '9888888888', address: 'x' });
        const dollar = await loginAgent('dollarngo', 'secret12');
        const listing = await postListing(donor, { totalQuantity: '3' });
        const res = await dollar.post('/api/listings/' + listing.id + '/claim').send({ quantity: 1 });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.claims[0].ngoName, '$totalQuantity Relief');
    });
});

describe('transactions', () => {
    it('a claim is logged with a timestamp, summary and quantity', async () => {
        const listing = await postListing(donor, { foodName: 'Logged Dal', totalQuantity: '4' });
        await ngoAgents[3].post('/api/listings/' + listing.id + '/claim').send({ quantity: 3 });

        const res = await admin.get('/api/transactions').query({ listingId: listing.id });
        assert.equal(res.status, 200);
        const types = res.body.data.map(t => t.type);
        assert.ok(types.includes('claim') && types.includes('listing_posted'), types.join(','));
        const claim = res.body.data.find(t => t.type === 'claim');
        assert.equal(claim.quantity, 3);
        assert.match(claim.summary, /Load NGO 3 claimed 3 boxes of Logged Dal/);
        assert.ok(!Number.isNaN(Date.parse(claim.createdAt)));
        assert.equal(claim.participants, undefined, 'internal visibility list is not exposed');
    });

    it('is newest first and supports paging with before', async () => {
        const all = (await admin.get('/api/transactions').query({ limit: 5 })).body.data;
        assert.equal(all.length, 5);
        for (let i = 1; i < all.length; i++) assert.ok(new Date(all[i - 1].createdAt) >= new Date(all[i].createdAt));
        const older = (await admin.get('/api/transactions').query({ limit: 5, before: all[4].createdAt })).body.data;
        assert.ok(older.every(t => new Date(t.createdAt) < new Date(all[4].createdAt)));
    });

    it('non-admins only see transactions they took part in', async () => {
        const listing = await postListing(donor, { foodName: 'Private Rice', totalQuantity: '4' });
        await ngoAgents[4].post('/api/listings/' + listing.id + '/claim').send({ quantity: 1 });

        const claimant = (await ngoAgents[4].get('/api/transactions').query({ listingId: listing.id })).body.data;
        assert.ok(claimant.some(t => t.type === 'claim'));
        const bystander = (await ngoAgents[5].get('/api/transactions').query({ listingId: listing.id })).body.data;
        assert.equal(bystander.length, 0, 'an unrelated NGO sees nothing');
        const owner = (await donor.get('/api/transactions').query({ listingId: listing.id })).body.data;
        assert.ok(owner.some(t => t.type === 'claim') && owner.some(t => t.type === 'listing_posted'));
    });

    it('records edits, removals, reviews and account decisions', async () => {
        const listing = await postListing(donor, { foodName: 'History Item', totalQuantity: '5' });
        await donor.patch('/api/listings/' + listing.id).send(listingFields({ foodName: 'History Item', totalQuantity: '8' }));
        await ngoAgents[6].post('/api/listings/' + listing.id + '/claim').send({ quantity: 2 });
        await ngoAgents[6].post('/api/reviews').send({ listingId: listing.id, rating: 4, comment: 'fine' });
        await admin.delete('/api/listings/' + listing.id);

        const rows = (await admin.get('/api/transactions').query({ listingId: listing.id })).body.data;
        const types = rows.map(t => t.type);
        ['listing_posted', 'listing_edited', 'claim', 'review_posted', 'listing_removed'].forEach(type => assert.ok(types.includes(type), 'missing ' + type));
        assert.match(rows.find(t => t.type === 'listing_edited').summary, /quantity/);

        const mine = (await ngoAgents[6].get('/api/transactions')).body.data;
        assert.ok(mine.some(t => t.type === 'listing_removed'), 'NGOs that claimed are told when a listing is removed');
    });

    it('requires login', async () => {
        assert.equal((await request(app).get('/api/transactions')).status, 401);
        assert.equal((await request(app).get('/api/transactions/stream')).status, 401);
    });
});

describe('live transaction stream (SSE)', () => {
    const http = require('http');

    function openStream(port, cookie) {
        return new Promise((resolve, reject) => {
            const req = http.get({ port: port, path: '/api/transactions/stream', headers: { Cookie: cookie } }, (res) => {
                const events = [];
                let buffer = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    buffer += chunk;
                    let idx;
                    while ((idx = buffer.indexOf('\n\n')) !== -1) {
                        const block = buffer.slice(0, idx);
                        buffer = buffer.slice(idx + 2);
                        const ev = /event: (.*)/.exec(block);
                        const data = /data: (.*)/.exec(block);
                        if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
                    }
                });
                resolve({ res: res, req: req, events: events });
            });
            req.on('error', reject);
        });
    }

    async function waitFor(fn, ms) {
        const end = Date.now() + (ms || 3000);
        while (Date.now() < end) {
            const v = fn();
            if (v) return v;
            await new Promise(r => setTimeout(r, 25));
        }
        return null;
    }

    async function cookieFor(username, password) {
        const res = await request(app).post('/api/auth/login').send({ username, password });
        return res.headers['set-cookie'][0].split(';')[0];
    }

    it('pushes new transactions to the right viewers as they happen', async () => {
        const server = app.listen(0);
        const port = server.address().port;
        const adminStream = await openStream(port, await cookieFor(config.adminUsername, config.adminPassword));
        const claimantStream = await openStream(port, await cookieFor('loadngo7', 'secret12'));
        const bystanderStream = await openStream(port, await cookieFor('loadngo8', 'secret12'));
        try {
            assert.match(adminStream.res.headers['content-type'], /^text\/event-stream/);

            const listing = await postListing(donor, { foodName: 'Streamed Roti', totalQuantity: '4' });
            await ngoAgents[7].post('/api/listings/' + listing.id + '/claim').send({ quantity: 2 });

            const adminGotClaim = await waitFor(() => adminStream.events.find(e => e.data.type === 'claim' && e.data.listingName === 'Streamed Roti'));
            assert.ok(adminGotClaim, 'admin receives the claim live');
            assert.equal(adminGotClaim.data.quantity, 2);
            assert.ok(await waitFor(() => claimantStream.events.find(e => e.data.type === 'claim' && e.data.listingName === 'Streamed Roti')), 'claimant receives it');
            await new Promise(r => setTimeout(r, 150));
            assert.equal(bystanderStream.events.filter(e => e.data.listingName === 'Streamed Roti').length, 0, 'an unrelated NGO receives nothing');
        } finally {
            [adminStream, claimantStream, bystanderStream].forEach(s => { s.req.destroy(); });
            await new Promise(r => server.close(r));
        }
    });
});
