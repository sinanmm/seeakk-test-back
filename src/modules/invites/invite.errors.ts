export class InviteError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'INVITE_ERROR') {
    super(message);
    this.name = 'InviteError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
