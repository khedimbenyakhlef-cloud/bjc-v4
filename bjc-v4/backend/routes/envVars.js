'use strict';
const r = require('express').Router({ mergeParams: true });
const c = require('../controllers/envController');
const auth = require('../middleware/auth');
r.use(auth);
r.get('/', c.list);
r.put('/', c.upsert);
r.delete('/:key', c.delete);
module.exports = r;
