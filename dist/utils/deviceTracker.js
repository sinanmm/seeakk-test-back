"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackUserDevice = void 0;
const ua_parser_js_1 = require("ua-parser-js");
const request_ip_1 = __importDefault(require("request-ip"));
const trackUserDevice = async (req, user) => {
    try {
        const deviceId = req.headers['x-device-id'];
        if (!deviceId)
            return;
        const userAgent = req.headers['user-agent'] || '';
        const parser = new ua_parser_js_1.UAParser(userAgent);
        const result = parser.getResult();
        const os = `${result.os.name || 'Unknown OS'} ${result.os.version || ''}`.trim();
        const browser = `${result.browser.name || 'Unknown Browser'} ${result.browser.version || ''}`.trim();
        const deviceType = result.device.type || 'desktop';
        const ipAddress = request_ip_1.default.getClientIp(req) || 'Unknown IP';
        const existingDeviceIndex = user.devices.findIndex((d) => d.deviceId === deviceId);
        if (existingDeviceIndex > -1) {
            user.devices[existingDeviceIndex].lastActive = new Date();
            user.devices[existingDeviceIndex].ipAddress = ipAddress;
            user.devices[existingDeviceIndex].os = os;
            user.devices[existingDeviceIndex].browser = browser;
            user.devices[existingDeviceIndex].deviceType = deviceType;
        }
        else {
            if (user.devices.length >= 10) {
                user.devices.sort((a, b) => a.lastActive.getTime() - b.lastActive.getTime());
                user.devices.shift();
            }
            user.devices.push({
                deviceId,
                os,
                browser,
                deviceType,
                ipAddress,
                lastActive: new Date(),
            });
        }
        await user.save();
    }
    catch (error) {
        console.error('Device tracking layer error:', error);
    }
};
exports.trackUserDevice = trackUserDevice;
