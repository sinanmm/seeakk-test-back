"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWorkspace = void 0;
const workspace_1 = __importDefault(require("../../models/Workspace/workspace"));
const user_1 = __importDefault(require("../../models/Auth/user"));
const role_1 = __importDefault(require("../../models/Auth/role"));
const logger_1 = __importDefault(require("../../utils/logger"));
const setupWorkspace = async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: 'Not authorized' });
        }
        const { companyName, employeeCount, timeZone, language, currencyLocale, loadSampleData } = req.body;
        if (user.isOnboarded) {
            return res.status(400).json({ message: 'Workspace is already set up for this user.' });
        }
        if (!companyName || !employeeCount) {
            return res.status(400).json({ message: 'Company Name and Employee Count are required.' });
        }
        const newWorkspace = await workspace_1.default.create({
            companyName,
            employeeCount,
            timeZone: timeZone || 'UTC',
            language: language || 'en-US',
            currencyLocale: currencyLocale || 'USD',
            loadSampleData: loadSampleData || false,
            owner: user._id,
        });
        let adminRole = await role_1.default.findOne({ name: 'admin' });
        if (!adminRole) {
            adminRole = await role_1.default.create({ name: 'admin', description: 'Super Administrator' });
        }
        const updatedUser = await user_1.default.findByIdAndUpdate(user._id, {
            workspace: newWorkspace._id,
            isOnboarded: true,
            role: adminRole._id,
        }, { new: true }).populate('role');
        logger_1.default.info('Workspace successfully configured', {
            workspaceId: newWorkspace._id,
            userId: user._id,
            action: 'workspace_setup',
        });
        return res.status(201).json({
            message: 'Workspace successfully configured!',
            workspace: newWorkspace,
            user: {
                id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                isOnboarded: updatedUser.isOnboarded,
                workspaceId: updatedUser.workspace,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.setupWorkspace = setupWorkspace;
