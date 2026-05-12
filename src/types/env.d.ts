declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT?: string;
      DATABASE_URL: string;
      REDIS_URL?: string;
      JWT_SECRET: string;
      JWT_REFRESH_SECRET: string;
      JWT_EXPIRES_IN?: string;
      EMAIL_USER?: string;
      EMAIL_PASS?: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      FRONTEND_URL?: string;
      /** Comma- or space-separated extra browser origins for CORS. */
      ALLOWED_ORIGINS?: string;
      /** Set to "false" to stop trusting all https://*.vercel.app origins. */
      CORS_ALLOW_VERCEL_APP?: string;
      BACKEND_URL?: string;
      EMAIL_SERVICE?: string;
      EMAIL_HOST?: string;
      EMAIL_PORT?: string;
      EMAIL_SECURE?: string;
      EMAIL_FROM?: string;
      FOLLOWUP_REMINDER_ENABLED?: string;
      FOLLOWUP_REMINDER_LEAD_TIME_MINUTES?: string;
      FOLLOWUP_REMINDER_POLL_SECONDS?: string;
    }
  }
}

export {};
