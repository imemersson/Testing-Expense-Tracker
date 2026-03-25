const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const isGoogleOAuthConfigured = Boolean(googleClientId && googleClientSecret);

if (isGoogleOAuthConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: "/api/auth/google/callback"
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) {
            return done(new Error("Google account did not return an email"), null);
          }

          let user = await User.findOne({ googleId: profile.id });
          if (!user) {
            user = await User.findOne({ email });
          }

          const photoUrl = profile.photos?.[0]?.value || "";

          if (!user) {
            user = await User.create({
              googleId: profile.id,
              name: profile.displayName || "Google User",
              email,
              profileImage: photoUrl,
              role: "user"
            });
          } else {
            user.googleId = profile.id;
            if (!user.profileImagePath && photoUrl) {
              user.profileImage = photoUrl;
            }
            if (!user.name && profile.displayName) {
              user.name = profile.displayName;
            }
            await user.save();
          }

          return done(null, user);
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
} else {
  console.warn(
    "Google OAuth disabled: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable /api/auth/google."
  );
}

module.exports = passport;
