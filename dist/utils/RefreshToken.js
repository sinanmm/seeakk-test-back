"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const generateTokens = (user) => {
    const tokenId = (0, uuid_1.v4)();
    const accessToken = jsonwebtoken_1.default.sign({
        userId: user._id,
        role: user.role,
    }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jsonwebtoken_1.default.sign({
        userId: user._id,
        tokenId,
    }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken, tokenId };
};
exports.default = generateTokens;
