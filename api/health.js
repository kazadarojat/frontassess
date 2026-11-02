'use strict';
const handleRequest = require('../server');

module.exports = (req, res) => {
  req.url = '/api/health';
  return handleRequest(req, res);
};
