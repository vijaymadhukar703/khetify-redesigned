const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Consumer = require('../model/Shop/Consumer');

/* Google login for customer-shop SHOPPERS.
 * Consumer collection use hota hai (User = team members, shoppers nahi). */
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const emailObj = profile.emails?.[0];
        const email = emailObj?.value?.toLowerCase().trim();
        const emailVerified = emailObj?.verified !== false;

        // 1) Pehle se Google se juda shopper
        let consumer = await Consumer.findOne({ googleId: profile.id });

        // 2) Same email se OTP/password wala account hai → usi se link karo
        if (!consumer && email && emailVerified) {
          consumer = await Consumer.findOne({ email });
          if (consumer) {
            await Consumer.updateOne(
              { _id: consumer._id },
              { $set: { googleId: profile.id, emailVerified: true } }
            );
          }
        }

        // 3) Naya shopper. phone field bhejna hi nahi (unique sparse index par
        //    '' do users me duplicate error deta).
        if (!consumer) {
          const randomPass = crypto.randomBytes(32).toString('hex');
          consumer = await Consumer.create({
            name: profile.displayName || (email ? email.split('@')[0] : 'Khetify Shopper'),
            email,
            googleId: profile.id,
            authMethod: 'google',
            emailVerified: !!email && emailVerified,
            passwordHash: await bcrypt.hash(randomPass, 10),
          });
        }

        if (consumer.status === 'disabled') return done(null, false);
        return done(null, consumer);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((consumer, done) => done(null, consumer.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await Consumer.findById(id));
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;