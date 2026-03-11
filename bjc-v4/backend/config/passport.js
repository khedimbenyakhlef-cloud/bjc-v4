'use strict';

const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const User = require('../models/User');
const logger = require('../utils/logger');

// ── JWT Strategy ─────────────────────────────────────────────
passport.use('jwt', new JwtStrategy(
  {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET,
  },
  async (payload, done) => {
    try {
      const user = await User.findById(payload.id);
      if (!user) return done(null, false);
      return done(null, user);
    } catch (err) {
      return done(err, false);
    }
  }
));

// ── Google OAuth 2.0 Strategy ────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use('google', new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
      scope: ['profile', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;
        const googleId = profile.id;
        const avatarUrl = profile.photos?.[0]?.value;

        if (!email) {
          return done(new Error('Aucun email fourni par Google'), null);
        }

        // Cherche un utilisateur existant (par google_id ou email)
        let user = await User.findByGoogleId(googleId);
        if (!user) {
          user = await User.findByEmail(email);
          if (user) {
            // Lier le compte Google à un compte email existant
            user = await User.linkGoogleAccount(user.id, googleId, avatarUrl);
          } else {
            // Créer un nouveau compte via Google
            user = await User.createFromGoogle({ email, name, googleId, avatarUrl });
          }
        }

        return done(null, user);
      } catch (err) {
        logger.error('Erreur stratégie Google OAuth', { error: err.message });
        return done(err, null);
      }
    }
  ));
} else {
  logger.warn('Google OAuth non configuré (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants)');
}

// ── Sérialisation session (utilisée seulement pour le flux OAuth) ──
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
