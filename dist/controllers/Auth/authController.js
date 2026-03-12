"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMe = exports.logout = exports.refreshToken = exports.googleLogin = exports.login = exports.verifyEmail = exports.register = exports.activateAccount = exports.inviteUser = void 0;
const googleAuthService_1 = __importDefault(require("../../services/Auth/googleAuthService"));
const RefreshToken_1 = __importDefault(require("../../utils/RefreshToken"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const user_1 = __importDefault(require("../../models/Auth/user"));
const redis_1 = require("../../config/redis");
const emailService_1 = require("../../services/Email/emailService");
const deviceTracker_1 = require("../../utils/deviceTracker");
const logger_1 = __importDefault(require("../../utils/logger"));
const inviteUser = async (req, res) => {
    return res.status(501).json({
        message: 'inviteUser is not implemented yet',
    });
};
exports.inviteUser = inviteUser;
const activateAccount = async (req, res) => {
    return res.status(501).json({
        message: 'activateAccount is not implemented yet',
    });
};
exports.activateAccount = activateAccount;
const register = async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        const existingUser = await user_1.default.findOne({ email });
        if (existingUser) {
            logger_1.default.warn('Failed registration attempt - Email already exists', {
                email,
                action: 'register_failed',
            });
            return res.status(400).json({ message: 'User already exists with this email' });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        const verificationToken = crypto_1.default.randomBytes(32).toString('hex');
        const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const user = await user_1.default.create({
            name,
            email,
            password: hashedPassword,
            isEmailVerified: false,
            verificationToken,
            verificationTokenExpires,
        });
        await (0, emailService_1.sendVerificationEmail)(user.email, verificationToken);
        return res.status(201).json({
            message: 'Registration successful. Please check your email to verify your account.',
        });
    }
    catch (error) {
        logger_1.default.error('System error during user registration', {
            error: error.message,
            stack: error.stack,
            email: req.body.email,
        });
        return res.status(500).json({ message: 'Registration failed' });
    }
};
exports.register = register;
const verifyEmail = async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).json({ message: 'Verification token is missing' });
        }
        const user = await user_1.default.findOne({
            verificationToken: token,
            verificationTokenExpires: { $gt: new Date() },
        });
        if (!user) {
            logger_1.default.warn('Failed email verification attempt - Invalid or expired token', {
                token,
                action: 'verify_email_failed',
            });
            return res.status(400).json({ message: 'Invalid or expired verification token' });
        }
        logger_1.default.info('Email successfully verified', {
            userId: user._id,
            email: user.email,
            action: 'verify_email_success',
        });
        user.isEmailVerified = true;
        user.verificationToken = undefined;
        user.verificationTokenExpires = undefined;
        await user.save();
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
    }
    catch (error) {
        console.error('Email verification error:', error);
        return res.status(500).json({ message: 'Email verification failed' });
    }
};
exports.verifyEmail = verifyEmail;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({
                message: 'Email and password are required',
            });
        }
        const user = await user_1.default.findOne({ email });
        if (!user) {
            logger_1.default.warn('Failed login attempt - User not found', { email, action: 'login_failed' });
            return res.status(401).json({
                message: 'Invalid credentials',
            });
        }
        if (!user.password) {
            return res.status(400).json({
                message: 'Password login is not enabled for this account',
            });
        }
        if (!user.isActive) {
            return res.status(403).json({
                message: 'Account is inactive',
            });
        }
        if (!user.isEmailVerified) {
            return res.status(403).json({
                message: 'Please verify your email address to log in. Check your inbox.',
            });
        }
        const isPasswordValid = await bcryptjs_1.default.compare(password, user.password);
        if (!isPasswordValid) {
            logger_1.default.warn('Failed login attempt - Incorrect password', {
                email,
                userId: user._id,
                action: 'login_failed',
            });
            return res.status(401).json({
                message: 'Invalid credentials',
            });
        }
        logger_1.default.info('Successful standard login', {
            email,
            userId: user._id,
            action: 'login_success',
        });
        const tokens = (0, RefreshToken_1.default)(user);
        await redis_1.redisClient.set(`refresh:${tokens.tokenId}`, user._id.toString());
        await (0, deviceTracker_1.trackUserDevice)(req, user);
        return res.status(200).json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                devices: user.devices,
                isOnboarded: user.isOnboarded,
            },
            ...tokens,
        });
    }
    catch (error) {
        return res.status(500).json({
            message: 'Login failed',
        });
    }
};
exports.login = login;
const googleLogin = async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({
                message: 'Google token is required',
            });
        }
        if (typeof token !== 'string' || token.split('.').length !== 3) {
            return res.status(400).json({
                message: 'Send a valid Google ID token (JWT), not Google client ID',
            });
        }
        let payload;
        try {
            payload = await (0, googleAuthService_1.default)(token);
        }
        catch (error) {
            logger_1.default.warn('Failed Google Login verification', {
                error: error.message,
                action: 'google_login_failed',
            });
            return res.status(401).json({
                message: 'Invalid or expired Google token',
            });
        }
        const { email, name, sub } = payload;
        let user = await user_1.default.findOne({ email });
        if (!user) {
            user = await user_1.default.create({
                name,
                email,
                googleId: sub,
                isEmailVerified: true,
            });
        }
        const tokens = (0, RefreshToken_1.default)(user);
        if (redis_1.redisClient?.isOpen) {
            await redis_1.redisClient.set(`refresh:${tokens.tokenId}`, user._id.toString());
        }
        else {
            console.warn('Redis is not connected. Skipping refresh token persistence for Google login.');
        }
        logger_1.default.info('Successful Google login', {
            email: user.email,
            userId: user._id,
            action: 'google_login_success',
        });
        await (0, deviceTracker_1.trackUserDevice)(req, user);
        res.json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                devices: user.devices,
                isOnboarded: user.isOnboarded,
            },
            ...tokens,
        });
    }
    catch (error) {
        console.error('googleLogin error:', error);
        res.status(500).json({
            message: 'Google login failed',
        });
    }
};
exports.googleLogin = googleLogin;
const refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ message: 'Refresh token is required' });
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        }
        catch (error) {
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }
        const { userId, tokenId } = decoded;
        const storedUserId = await redis_1.redisClient.get(`refresh:${tokenId}`);
        if (!storedUserId || storedUserId !== userId.toString()) {
            logger_1.default.warn('Failed Refresh Token rotation - Token inactive or stolen', {
                userId,
                tokenId,
                action: 'refresh_token_rejected',
            });
            return res.status(401).json({ message: 'Invalid refresh token or already consumed' });
        }
        await redis_1.redisClient.del(`refresh:${tokenId}`);
        const user = await user_1.default.findById(userId);
        if (!user || !user.isActive) {
            return res.status(403).json({ message: 'User not found or inactive' });
        }
        const tokens = (0, RefreshToken_1.default)(user);
        await redis_1.redisClient.set(`refresh:${tokens.tokenId}`, user._id.toString());
        await (0, deviceTracker_1.trackUserDevice)(req, user);
        return res.status(200).json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                devices: user.devices,
                isOnboarded: user.isOnboarded,
            },
            ...tokens,
        });
    }
    catch (error) {
        console.error('Refresh token error:', error);
        return res.status(500).json({ message: 'Failed to refresh token' });
    }
};
exports.refreshToken = refreshToken;
const logout = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(200).json({ message: 'Logged out successfully' });
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
                ignoreExpiration: true,
            });
        }
        catch (error) {
            return res.status(200).json({ message: 'Logged out successfully' });
        }
        if (decoded && decoded.tokenId) {
            await redis_1.redisClient.del(`refresh:${decoded.tokenId}`);
        }
        return res.status(200).json({ message: 'Logged out successfully' });
    }
    catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({ message: 'Logout failed' });
    }
};
exports.logout = logout;
const getMe = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: 'Not authorized' });
        }
        return res.status(200).json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                devices: user.devices,
                isEmailVerified: user.isEmailVerified,
            },
        });
    }
    catch (error) {
        return res.status(500).json({ message: 'Failed to fetch user profile' });
    }
};
exports.getMe = getMe;
