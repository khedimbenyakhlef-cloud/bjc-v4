'use strict';

const router = require('express').Router();
const deployController = require('../controllers/deployController');
const auth = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');

router.use(auth);

router.post('/', uploadLimiter, deployController.deploySite);
router.get('/:siteId/history', deployController.getHistory);

module.exports = router;
