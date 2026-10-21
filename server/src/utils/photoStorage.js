const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const AppError = require('./AppError');

// Detects the real image type from the file's first bytes. The
// client-supplied mimetype / filename cannot be trusted.
function detectImageExtension(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
    return null;
}

// Throws before anything is written so a bad file never reaches the disk.
function assertValidPhoto(file) {
    const extension = detectImageExtension(file.buffer);
    if (!extension) throw new AppError(422, 'INVALID_UPLOAD', 'Photo must be a JPEG, PNG or WebP image.');
    return extension;
}

async function savePhoto(file, extension) {
    const fileName = crypto.randomUUID() + extension;
    await fs.mkdir(config.uploadDir, { recursive: true });
    await fs.writeFile(path.join(config.uploadDir, fileName), file.buffer);
    return '/uploads/' + fileName;
}

async function deletePhoto(photoUrl) {
    if (!photoUrl) return;
    // basename() guards against a tampered DB value escaping the upload dir.
    await fs.rm(path.join(config.uploadDir, path.basename(photoUrl)), { force: true });
}

module.exports = { assertValidPhoto, savePhoto, deletePhoto };
