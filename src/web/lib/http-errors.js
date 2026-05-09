export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(msg, code = 'BAD_REQUEST') {
  return new HttpError(400, msg, code);
}

export function unauthorized(msg = 'Unauthorized', code = 'UNAUTHORIZED') {
  return new HttpError(401, msg, code);
}

export function notFound(msg = 'Not Found', code = 'NOT_FOUND') {
  return new HttpError(404, msg, code);
}

export function conflict(msg, code = 'CONFLICT') {
  return new HttpError(409, msg, code);
}
