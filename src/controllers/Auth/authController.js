const verifyGoogleToken = require("../../services/Auth/googleAuthService");
const generateTokens = require("../../utils/RefreshToken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../../models/Auth/user");
const { redisClient } = require("../../config/redis");
const { sendVerificationEmail } = require("../../services/Email/emailService");
const { trackUserDevice } = require("../../utils/deviceTracker");
const logger = require("../../utils/logger");

exports.inviteUser = async (req, res) => {
  return res.status(501).json({
    message: "inviteUser is not implemented yet",
  });
};

exports.activateAccount = async (req, res) => {
  return res.status(501).json({
    message: "activateAccount is not implemented yet",
  });
};

exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      logger.warn("Failed registration attempt - Email already exists", { email, action: 'register_failed' });
      return res.status(400).json({ message: "User already exists with this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      isEmailVerified: false,
      verificationToken,
      verificationTokenExpires,
    });

    // Send email
    await sendVerificationEmail(user.email, verificationToken);

    return res.status(201).json({
      message: "Registration successful. Please check your email to verify your account.",
    });
  } catch (error) {
    logger.error("System error during user registration", { error: error.message, stack: error.stack, email: req.body.email });
    return res.status(500).json({ message: "Registration failed" });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Verification token is missing" });
    }

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      logger.warn("Failed email verification attempt - Invalid or expired token", { token, action: 'verify_email_failed' });
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    logger.info("Email successfully verified", { userId: user._id, email: user.email, action: 'verify_email_success' });

    user.isEmailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    // Ideally, send HTML page back acting as success state, or redirect to frontend login
    return res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f9fafb;">
          <div style="text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h1 style="color: #10b981;">Email Verified! ✅</h1>
            <p style="color: #6b7280; font-size: 1.1rem; margin-top: 10px;">Your account has been successfully activated.</p>
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Go to Login</a>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Email verification error:", error);
    return res.status(500).json({ message: "Email verification failed" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      logger.warn("Failed login attempt - User not found", { email, action: 'login_failed' });
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        message: "Password login is not enabled for this account",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        message: "Account is inactive",
      });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: "Please verify your email address to log in. Check your inbox.",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      logger.warn("Failed login attempt - Incorrect password", { email, userId: user._id, action: 'login_failed' });
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    logger.info("Successful standard login", { email, userId: user._id, action: 'login_success' });

    const tokens = generateTokens(user);

    await redisClient.set(`refresh:${tokens.tokenId}`, user._id.toString());
    await trackUserDevice(req, user);

    return res.status(200).json({
      user: { id: user._id, name: user.name, email: user.email, devices: user.devices },
      ...tokens
    });
  } catch (error) {
    return res.status(500).json({
      message: "Login failed",
    });
  }
};

exports.googleLogin = async (req, res) => {

  try {

    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        message: "Google token is required",
      });
    }

    if (typeof token !== "string" || token.split(".").length !== 3) {
      return res.status(400).json({
        message: "Send a valid Google ID token (JWT), not Google client ID",
      });
    }

    let payload;
    try {
      payload = await verifyGoogleToken(token);
    } catch (error) {
      logger.warn("Failed Google Login verification", { error: error.message, action: 'google_login_failed' });
      return res.status(401).json({
        message: "Invalid or expired Google token",
      });
    }

    const { email, name, sub } = payload;

    let user = await User.findOne({ email });

    if (!user) {

      user = await User.create({
        name,
        email,
        googleId: sub,
        isEmailVerified: true // Automatically verified if logged in via Google
      });

    }

    const tokens = generateTokens(user);

    // If Redis is unavailable, don't block Google login.
    // Refresh token validation may be limited until Redis is connected.
    if (redisClient?.isOpen) {
      await redisClient.set(
        `refresh:${tokens.tokenId}`,
        user._id.toString()
      );
    } else {
      console.warn("Redis is not connected. Skipping refresh token persistence for Google login.");
    }

    logger.info("Successful Google login", { email: user.email, userId: user._id, action: 'google_login_success' });
    await trackUserDevice(req, user);

    res.json({
      user: { id: user._id, name: user.name, email: user.email, devices: user.devices },
      ...tokens
    });

  } catch (error) {
    console.error("googleLogin error:", error);

    res.status(500).json({
      message: "Google login failed"
    });

  }

};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (error) {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }

    const { userId, tokenId } = decoded;

    // Check if token exists in Redis (Whitelist / Rotation validation)
    const storedUserId = await redisClient.get(`refresh:${tokenId}`);

    if (!storedUserId || storedUserId !== userId.toString()) {
      logger.warn("Failed Refresh Token rotation - Token inactive or stolen", { userId, tokenId, action: 'refresh_token_rejected' });
      return res.status(401).json({ message: "Invalid refresh token or already consumed" });
    }

    // Invalidating the used token (Token Rotation step 1)
    await redisClient.del(`refresh:${tokenId}`);

    // Fetch user to issue new tokens
    const user = await User.findById(userId);
    if (!user || !user.isActive) {
      return res.status(403).json({ message: "User not found or inactive" });
    }

    // Generate new token pair (Token Rotation step 2)
    const tokens = generateTokens(user);

    // Save new token ID in Redis whitelist (Token Rotation step 3)
    await redisClient.set(`refresh:${tokens.tokenId}`, user._id.toString());
    await trackUserDevice(req, user);

    return res.status(200).json({
      user: { id: user._id, name: user.name, email: user.email, devices: user.devices },
      ...tokens
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    return res.status(500).json({ message: "Failed to refresh token" });
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      // If none provided, simply succeed to wipe frontend state
      return res.status(200).json({ message: "Logged out successfully" });
    }

    let decoded;
    try {
      // We ignore expiration checking on logout since we just want to wipe it from db securely
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, { ignoreExpiration: true });
    } catch (error) {
      return res.status(200).json({ message: "Logged out successfully" });
    }

    // Invalidate the token from Redis
    if (decoded && decoded.tokenId) {
      await redisClient.del(`refresh:${decoded.tokenId}`);
    }

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ message: "Logout failed" });
  }
};

exports.getMe = async (req, res) => {
  try {
    // Because this route is protected by `protect` middleware, 
    // `req.user` is already populated securely.
    const user = req.user;

    return res.status(200).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        devices: user.devices,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch user profile" });
  }
};
