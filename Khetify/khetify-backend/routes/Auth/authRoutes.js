const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const { me } = require("../../controller/Auth/authController");


const passport = require('../../config/googleAuth');
const { signConsumerToken } = require('../../services/shopAuthService');

// Current principal + capabilities. Used by the frontend usePermission() hook.
router.get("/me", auth, me);

// Google OAuth routes
// Google OAuth routes (customer-shop shoppers). JWT use hota hai, session nahi.
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL}/customer-shop/login?error=google_failed`,
  }),
  (req, res) => {
    try {
      // req.user yahan ek Consumer document hai
      const token = signConsumerToken(req.user);
      res.redirect(`${process.env.FRONTEND_URL}/customer-shop/register?token=${token}&success=true`);
    } catch (error) {
      res.redirect(`${process.env.FRONTEND_URL}/customer-shop/login?error=auth_failed`);
    }
  }
);


module.exports = router;
