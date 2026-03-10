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
        default: "UTC",
    },
    language: {
        type: String,
        required: true,
        default: "en-US",
    },
    currencyLocale: {
        type: String,
        required: true,
        default: "USD",
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
