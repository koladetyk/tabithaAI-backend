const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// Initialize Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.NODE_ENV === 'production' 
    ? 'https://web-production-877a.up.railway.app/api/v1/auth/google/callback'
    : 'http://localhost:3000/api/v1/auth/google/callback',
  scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Check if user exists in database
    const existingUser = await db.query(
      'SELECT * FROM users WHERE email = $1', 
      [profile.emails[0].value]
    );
    
    if (existingUser.rows.length > 0) {
      // User exists, return user
      return done(null, existingUser.rows[0]);
    }
    
    // Create new user with Google profile info
    const userId = uuidv4();
    const newUser = await db.query(
      `INSERT INTO users (
        id,
        username,
        email,
        password_hash,
        full_name,
        is_verified,
        created_at,
        updated_at,
        google_id
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7) RETURNING *`,
      [
        userId,
        profile.emails[0].value.split('@')[0], // Use email prefix as username
        profile.emails[0].value,
        'google-auth-' + uuidv4(), // Placeholder for password
        profile.displayName || profile.name.givenName + ' ' + profile.name.familyName,
        true, // Verified automatically since Google verified the email
        profile.id
      ]
    );
    
    return done(null, newUser.rows[0]);
  } catch (error) {
    return done(error, null);
  }
}));

// Serialize user for the session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from the session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, user.rows[0]);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;