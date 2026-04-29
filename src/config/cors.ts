export const getAllowedOrigins = (): string[] =>
  [
    process.env.FRONTEND_URL,
    process.env.ALLOWED_ORIGINS,
    'http://localhost:5173',
    'http://localhost:3000',
  ].filter(Boolean) as string[];

export const corsOriginHandler = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => {
  const allowed = getAllowedOrigins();
  if (!origin || allowed.includes(origin)) {
    callback(null, true);
  } else {
    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error(`Not allowed by CORS: ${origin}`));
  }
};
