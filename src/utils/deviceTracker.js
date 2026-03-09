const UAParser = require("ua-parser-js");
const requestIp = require("request-ip");

/**
 * Tracks the user's current device based on headers.
 * Updates the existing device footprint or registers a new device layer if 'x-device-id' is unseen.
 * @param {Object} req - Express request object
 * @param {Object} user - Mongoose User document
 */
exports.trackUserDevice = async (req, user) => {
    try {
        const deviceId = req.headers["x-device-id"];

        // Return silently if physical device ID mapping isn't implemented strictly in API req headers
        if (!deviceId) return;

        // Parse strictly the hardware, OS, and software info
        const parser = new UAParser(req.headers["user-agent"]);
        const result = parser.getResult();

        const os = `${result.os.name || "Unknown OS"} ${result.os.version || ""}`.trim();
        const browser = `${result.browser.name || "Unknown Browser"} ${result.browser.version || ""}`.trim();
        const deviceType = result.device.type || "desktop"; // ua-parser-js returns undefined for standard desktop browsers

        // Safely extract client IP from proxies/load-balancers if applicable
        const ipAddress = requestIp.getClientIp(req) || "Unknown IP";

        const existingDeviceIndex = user.devices.findIndex((d) => d.deviceId === deviceId);

        if (existingDeviceIndex > -1) {
            // Update existing footprint ping status
            user.devices[existingDeviceIndex].lastActive = Date.now();
            user.devices[existingDeviceIndex].ipAddress = ipAddress;
            user.devices[existingDeviceIndex].os = os;              // Overwrite in case browser/os updated natively over time
            user.devices[existingDeviceIndex].browser = browser;
            user.devices[existingDeviceIndex].deviceType = deviceType;
        } else {
            // Keep maximum device tracking array length constrained conceptually (optional boundary like top 10 devices active)
            if (user.devices.length >= 10) {
                // Removes oldest device by date to prevent boundless schema growth
                user.devices.sort((a, b) => a.lastActive - b.lastActive);
                user.devices.shift();
            }

            // Add fresh device hardware profile to schema
            user.devices.push({
                deviceId,
                os,
                browser,
                deviceType,
                ipAddress,
                lastActive: Date.now()
            });
        }

        await user.save();
    } catch (error) {
        console.error("Device tracking layer error:", error);
    }
};
