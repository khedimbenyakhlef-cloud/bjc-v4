'use strict';
const r = require('express').Router({ mergeParams: true });
const c = require('../controllers/databaseController');
const auth = require('../middleware/auth');
r.use(auth);
r.get('/', c.list);
r.post('/provision', c.provision);
r.get('/:dbId/credentials', c.getCredentials);
module.exports = r;
