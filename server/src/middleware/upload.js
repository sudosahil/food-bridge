const multer = require('multer');
const config = require('../config');

// Memory storage: the file is only written to disk by the service after the
// listing fields validate and the real file type has been checked.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxPhotoBytes, files: 1 }
});

module.exports = { uploadPhoto: upload.single('photo') };
