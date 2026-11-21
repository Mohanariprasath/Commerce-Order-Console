const { open, seed } = require('../src/db');
const { createHandler } = require('../src/server');

let handler;

module.exports = async (req, res) => {
  if (!handler) {
    const db = open();
    seed(db);
    handler = createHandler(db);
  }
  return handler(req, res);
};
