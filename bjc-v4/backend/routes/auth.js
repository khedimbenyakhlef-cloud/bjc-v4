'use strict';

const router = require('express').Router();
const passport = require('../config/passport');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// ── Email / Mot de passe ─────────────────────────────────────
router.post('/register', validate(schemas.register), authController.register);
router.post('/login', validate(schemas.login), authController.login);
router.get('/me', auth, authController.me);

// ── Google OAuth 2.0 ─────────────────────────────────────────
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=oauth_failed', session: false }),
  authController.googleCallback
);

module.exports = router;
