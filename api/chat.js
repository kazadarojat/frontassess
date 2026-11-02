'use strict';
const handleRequest = require('../server');

module.exports = (req, res) => {
  req.url = '/api/chat';
  return handleRequest(req, res);
};
