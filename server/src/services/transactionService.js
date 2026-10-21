const EventEmitter = require('events');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');

// In-process pub/sub that feeds the live stream. Fine for one server
// process; running several would need a shared bus (e.g. Redis or Mongo
// change streams).
const bus = new EventEmitter();
bus.setMaxListeners(0);

function canSee(user, participants) {
    return user.role === 'admin' || participants.includes(user.username);
}

// Logging must never break the action that triggered it, so failures are
// reported and swallowed.
async function record(entry) {
    try {
        const participants = Array.from(new Set([entry.actorUsername, entry.donorUsername, entry.ngoUsername].concat(entry.alsoVisibleTo || []).filter(Boolean)));
        const data = Object.assign({}, entry, { participants: participants });
        delete data.alsoVisibleTo;
        const tx = await Transaction.create(data);
        bus.emit('transaction', { participants: participants, payload: tx.toJSON() });
        return tx;
    } catch (err) {
        console.error('Failed to record transaction:', err);
        return null;
    }
}

async function list(user, query) {
    const filter = {};
    if (user.role !== 'admin') filter.participants = user.username;
    if (query.before) filter.createdAt = { $lt: query.before };
    if (query.listingId) {
        if (!mongoose.isValidObjectId(query.listingId)) return [];
        filter.listingId = query.listingId;
    }
    if (query.username) filter.participants = query.username;
    return Transaction.find(filter).sort({ createdAt: -1 }).limit(query.limit);
}

// Server-Sent Events: the browser's EventSource sends the session cookie
// and reconnects by itself if the connection drops.
function openStream(user, req, res) {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    function onTransaction(event) {
        if (!canSee(user, event.participants)) return;
        res.write('event: transaction\ndata: ' + JSON.stringify(event.payload) + '\n\n');
    }
    bus.on('transaction', onTransaction);
    const heartbeat = setInterval(function () { res.write(': ping\n\n'); }, 25000);

    req.on('close', function () {
        clearInterval(heartbeat);
        bus.off('transaction', onTransaction);
    });
}

module.exports = { record, list, openStream };
