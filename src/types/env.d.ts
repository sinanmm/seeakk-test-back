declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT?: string;
      MONGO_URI: string;
      REDIS_URL?: string;
      JWT_SECRET: string;
      JWT_EXPIRES_IN?: string;
      EMAIL_USER?: string;
      EMAIL_PASS?: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
    }
  }
}

export {};
