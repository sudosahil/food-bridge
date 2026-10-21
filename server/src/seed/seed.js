// Usage: npm run seed   (drops all users, listings and reviews, then reseeds)
const mongoose = require('mongoose');
const { connectDb } = require('../db');
const { resetAndSeed } = require('./seedData');

async function main() {
    await connectDb();
    await resetAndSeed();
    console.log('Database reset and reseeded.');
}

main()
    .catch(function (err) {
        console.error('Seed failed:', err.message);
        process.exitCode = 1;
    })
    .finally(function () { return mongoose.disconnect(); });
