import mongoose, { Document, Schema } from 'mongoose';

export interface IWorkspace extends Document {
  companyName: string;
  employeeCount: string;
  timeZone: string;
  language: string;
  currencyLocale: string;
  loadSampleData: boolean;
  owner: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
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
      default: 'UTC',
    },
    language: {
      type: String,
      required: true,
      default: 'en-US',
    },
    currencyLocale: {
      type: String,
      required: true,
      default: 'USD',
    },
    loadSampleData: {
      type: Boolean,
      default: false,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IWorkspace>('Workspace', workspaceSchema);
