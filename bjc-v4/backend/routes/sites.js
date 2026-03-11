'use strict';

const router = require('express').Router();
const siteController = require('../controllers/siteController');
const auth = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

router.use(auth);

router.get('/', siteController.getSites);
router.post('/', validate(schemas.createSite), siteController.createSite);
router.get('/:id', siteController.getSite);
router.delete('/:id', siteController.deleteSite);

module.exports = router;
