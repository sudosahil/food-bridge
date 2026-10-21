require('dotenv').config({ quiet: true });
const path = require('path');

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

function requireInProduction(name, devDefault) {
    const value = process.env[name];
    if (value) return value;
    if (isProduction) throw new Error(name + ' must be set in production.');
    return devDefault;
}

module.exports = {
    env,
    isProduction,
    port: Number(process.env.PORT) || 3000,
    mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/surplus_food_bridge',
    jwtSecret: requireInProduction('JWT_SECRET', 'dev-only-secret-change-me'),
    jwtExpiresIn: '8h',
    cookieMaxAgeMs: 8 * 60 * 60 * 1000,
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: requireInProduction('ADMIN_PASSWORD', 'admin1234'),
    uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
    maxPhotoBytes: 3 * 1024 * 1024,
    rootDir: path.join(__dirname, '..', '..')
};
