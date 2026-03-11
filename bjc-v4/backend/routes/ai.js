'use strict';

const router = require('express').Router();
const aiController = require('../controllers/aiController');
const auth = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

router.use(auth);
router.post('/generate', validate(schemas.aiGenerate), aiController.generate);

module.exports = router;
