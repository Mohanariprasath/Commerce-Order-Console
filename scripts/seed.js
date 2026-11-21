const { open, seed } = require('../src/db');
const reset = process.argv.includes('--reset');
const db = open();
const did = seed(db, { reset });
console.log(did ? `Catalogue seeded${reset ? ' (database reset)' : ''}.` : 'Catalogue already present; nothing changed (use --reset to wipe).');
