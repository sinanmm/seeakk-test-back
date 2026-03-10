const mongoose = require("mongoose");

const workspaceSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: true,
        trim: true,
    },
    employeeCount: {
        type: String,
        required: true,
    },
    timeZone: {
        type: String,
        required: true,
        default: "GMT +5:30",
    },
    language: {
        type: String,
        required: true,
        default: "English (US)",
    },
    currencyLocale: {
        type: String,
        required: true,
        default: "India (INR)",
    },
    loadSampleData: {
        type: Boolean,
        default: false,
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model("Workspace", workspaceSchema);
