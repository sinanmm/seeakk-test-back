declare module 'request-ip' {
  import { Request } from 'express';

  interface RequestIp {
    getClientIp(req: Request): string | null;
  }

  const requestIp: RequestIp;
  export default requestIp;
}

declare module 'nodemailer' {
  export interface Transporter {
    sendMail(options: unknown): Promise<unknown>;
  }

  export function createTransport(config: unknown): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}
