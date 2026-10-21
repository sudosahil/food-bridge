const mongoose = require('mongoose');
const config = require('./config');

async function connectDb(uri) {
    await mongoose.connect(uri || config.mongoUri);
    // Make sure unique/compound indexes exist before the first request.
    await mongoose.connection.syncIndexes();
}

module.exports = { connectDb };
