const bcrypt = require('bcryptjs');
const config = require('../config');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const transactionService = require('./transactionService');

// Compared against when the username does not exist, so a login attempt
// takes about as long either way and cannot be used to probe usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

async function hashPassword(password) {
    return bcrypt.hash(password, config.bcryptRounds);
}

async function register(input) {
    const existing = await User.exists({ username: input.username });
    if (existing) throw new AppError(409, 'USERNAME_TAKEN', 'That username is already taken. Please choose another one.');

    const user = await User.create({
        username: input.username,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        name: input.name,
        zoneId: input.zoneId,
        phone: input.phone,
        address: input.address,
        registrationNumber: input.registrationNumber,
        description: input.role === 'donor' ? (input.description || '') : undefined,
        verificationStatus: 'pending'
    });

    await transactionService.record({
        type: 'user_registered',
        actorUsername: user.username, actorName: user.name, actorRole: user.role,
        summary: user.name + ' registered as ' + (user.role === 'ngo' ? 'an NGO' : 'a donor') + ' and is waiting for approval'
    });
    return user;
}

async function login(username, password) {
    const user = await User.findOne({ username }).select('+passwordHash');
    const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !matches) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    if (!user.active) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended.');
    return user;
}

module.exports = { register, login, hashPassword };
