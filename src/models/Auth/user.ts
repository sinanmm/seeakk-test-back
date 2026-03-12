import mongoose, { Document, Schema } from 'mongoose';
import { IRole } from './role';

export interface IDevice {
  deviceId: string;
  os?: string;
  browser?: string;
  deviceType?: string;
  ipAddress?: string;
  lastActive: Date;
}

export interface IUser extends Document {
  name?: string;
  email: string;
  password?: string;
  googleId?: string;
  role?: mongoose.Types.ObjectId | IRole;
  workspace?: mongoose.Types.ObjectId;
  isOnboarded: boolean;
  isActive: boolean;
  invitationToken?: string;
  invitationExpires?: Date;
  isEmailVerified: boolean;
  verificationToken?: string;
  verificationTokenExpires?: Date;
  devices: IDevice[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: String,
    email: {
      type: String,
      unique: true,
      required: true,
    },
    password: { type: String },
    googleId: String,
    role: {
      type: Schema.Types.ObjectId,
      ref: 'Role',
    },
    workspace: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
    },
    isOnboarded: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    invitationToken: String,
    invitationExpires: Date,
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    verificationToken: String,
    verificationTokenExpires: Date,
    devices: [
      {
        deviceId: { type: String, required: true },
        os: String,
        browser: String,
        deviceType: String,
        ipAddress: String,
        lastActive: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', userSchema);