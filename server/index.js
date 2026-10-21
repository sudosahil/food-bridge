const config = require('./src/config');
const { connectDb } = require('./src/db');
const { createApp } = require('./src/app');
const { ensureSeeded } = require('./src/seed/seedData');

async function main() {
    await connectDb();
    await ensureSeeded();

    createApp().listen(config.port, function () {
        console.log('Surplus Food Bridge running at http://localhost:' + config.port);
    });
}

main().catch(function (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
});
