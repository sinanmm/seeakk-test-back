const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        enum: ["admin", "manager", "user", "customer"]
    },
    description: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model("Role", roleSchema);
