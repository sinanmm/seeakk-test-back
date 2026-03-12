import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectRedis } from './config/redis';
import prisma from './config/prisma';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect Redis
    connectRedis();

    // Test Prisma / PostgreSQL connection
    await prisma.$connect();
    console.log('PostgreSQL connected via Prisma ✅');

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();