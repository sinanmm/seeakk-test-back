const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({

  name: String,

  email: {
    type: String,
    unique: true
  },

  password: String,

  googleId: String,

  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Role"
  },

  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace"
  },

  isOnboarded: {
    type: Boolean,
    default: false
  },

  isActive: {
    type: Boolean,
    default: true
  },

  invitationToken: String,

  invitationExpires: Date,

  isEmailVerified: {
    type: Boolean,
    default: false
  },

  verificationToken: String,

  verificationTokenExpires: Date,

  devices: [{
    deviceId: { type: String, required: true },
    os: String,
    browser: String,
    deviceType: String,
    ipAddress: String,
    lastActive: { type: Date, default: Date.now },
  }]

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);