const mongoose = require('mongoose');
const { TRANSACTION_TYPES } = require('../constants');

// Append-only activity log. `summary` is a ready-to-show sentence written
// when the event happened, so history still reads correctly after a user
// renames themselves or a listing is deleted.
const transactionSchema = new mongoose.Schema({
    type: { type: String, enum: TRANSACTION_TYPES, required: true, index: true },
    actorUsername: { type: String, required: true },
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
    listingId: { type: mongoose.Schema.Types.ObjectId, index: true },
    listingName: { type: String },
    donorUsername: { type: String },
    ngoUsername: { type: String },
    quantity: { type: Number },
    unit: { type: String },
    summary: { type: String, required: true },
    // Everyone who should see this event in their own transaction list.
    participants: { type: [String], index: true, default: [] }
}, {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
        transform: function (_doc, ret) {
            ret.id = String(ret._id);
            delete ret._id;
            delete ret.__v;
            delete ret.participants;
            return ret;
        }
    }
});

transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
