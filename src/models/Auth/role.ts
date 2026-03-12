import mongoose, { Document, Schema } from 'mongoose';

export interface IRole extends Document {
  name: 'admin' | 'manager' | 'user' | 'customer';
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ['admin', 'manager', 'user', 'customer'],
    },
    description: {
      type: String,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IRole>('Role', roleSchema);
