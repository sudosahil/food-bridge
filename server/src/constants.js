// Mirrors ZONES / UNITS in js/common.js (the browser keeps the display names).
const ZONE_IDS = ['colaba', 'bandra', 'andheri', 'kurla', 'borivali', 'powai'];
const UNITS = ['servings', 'kg', 'boxes', 'trays', 'liters', 'pieces'];
const ROLES = ['donor', 'ngo', 'admin'];
const SELF_REGISTER_ROLES = ['donor', 'ngo'];
const VERIFICATION_STATUSES = ['pending', 'approved', 'unapproved'];
const TRANSACTION_TYPES = [
    'user_registered', 'user_approved', 'user_unapproved', 'user_suspended', 'user_reactivated', 'user_deleted',
    'listing_posted', 'listing_edited', 'listing_removed', 'claim', 'review_posted'
];

module.exports = { ZONE_IDS, UNITS, ROLES, SELF_REGISTER_ROLES, VERIFICATION_STATUSES, TRANSACTION_TYPES };
