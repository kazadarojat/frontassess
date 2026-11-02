'use strict';
const handleRequest = require('../server');

module.exports = (req, res) => {
  req.url = '/api/models';
  return handleRequest(req, res);
};
