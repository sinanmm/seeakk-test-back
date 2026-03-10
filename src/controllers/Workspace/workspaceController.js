const Workspace = require("../../models/Workspace/workspace");
const User = require("../../models/Auth/user");
const Role = require("../../models/Auth/role");
const logger = require("../../utils/logger");

exports.setupWorkspace = async (req, res, next) => {
    try {
        const { companyName, employeeCount, timeZone, language, currencyLocale, loadSampleData } = req.body;

        // Ensure user isn't already onboarded
        if (req.user.isOnboarded) {
            return res.status(400).json({ message: "Workspace is already set up for this user." });
        }

        if (!companyName || !employeeCount) {
            return res.status(400).json({ message: "Company Name and Employee Count are required." });
        }

        // 1. Create the unique workspace
        const newWorkspace = await Workspace.create({
            companyName,
            employeeCount,
            timeZone: timeZone || "UTC",
            language: language || "en-US",
            currencyLocale: currencyLocale || "USD",
            loadSampleData: loadSampleData || false,
            owner: req.user._id,
        });

        // 2. Fetch or Create the "admin" role (so the first user becomes an admin)
        // Normally, roles should be pre-seeded in the database, but this guarantees it won't break.
        let adminRole = await Role.findOne({ name: "admin" });
        if (!adminRole) {
            adminRole = await Role.create({ name: "admin", description: "Super Administrator" });
        }

        // 3. Update the User with their new workspace, onboarded status, and Admin role
        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            {
                workspace: newWorkspace._id,
                isOnboarded: true,
                role: adminRole._id, // Assign Admin role natively to the creator
            },
            { new: true }
        ).populate("role"); // Re-populate for the response

        logger.info("Workspace successfully configured", {
            workspaceId: newWorkspace._id,
            userId: req.user._id,
            action: "workspace_setup"
        });

        return res.status(201).json({
            message: "Workspace successfully configured!",
            workspace: newWorkspace,
            user: {
                id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                isOnboarded: updatedUser.isOnboarded,
                workspaceId: updatedUser.workspace
            }
        });
    } catch (error) {
        next(error); // Passes securely to our new global errorHandler!
    }
};
