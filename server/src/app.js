const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// The static site lives in the project root next to server/, so only these
// explicit files are served (never the whole root, which holds server code,
// .env and the documents).
const PAGES = ['index.html', 'donor.html', 'ngo.html', 'supplier.html', 'admin.html', 'admin-user.html', 'listing.html', 'transactions.html'];

function createApp() {
    const app = express();

    app.disable('x-powered-by');
    app.use(function (req, _res, next) {
        req.id = crypto.randomUUID().slice(0, 8);
        next();
    });

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
                scriptSrcAttr: ["'none'"],
                styleSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
                // Cards set a progress-bar width with an inline style attribute.
                styleSrcAttr: ["'unsafe-inline'"],
                fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                imgSrc: ["'self'", 'data:'],
                // Would rewrite http://localhost requests to https and break local dev.
                upgradeInsecureRequests: config.isProduction ? [] : null
            }
        }
    }));
    app.use(express.json({ limit: '100kb' }));
    app.use(cookieParser());

    app.use('/api', routes);
    app.use('/api', notFoundHandler);

    // ---------- static frontend ----------
    app.use('/js', express.static(path.join(config.rootDir, 'js')));
    app.use('/uploads', express.static(config.uploadDir));
    app.get('/style.css', function (_req, res) { res.sendFile(path.join(config.rootDir, 'style.css')); });
    app.get('/', function (_req, res) { res.sendFile(path.join(config.rootDir, 'index.html')); });
    PAGES.forEach(function (page) {
        app.get('/' + page, function (_req, res) { res.sendFile(path.join(config.rootDir, page)); });
    });

    app.use(errorHandler);
    return app;
}

module.exports = { createApp };
