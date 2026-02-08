export type ApiResult<T> = { code: number; message: string; data?: T };
export const ok = <T>(data: T): ApiResult<T> => ({ code: 0, message: 'OK', data });

export class AppError extends Error {
  constructor(public code: number, message: string, public status = 400) {
    super(message);
  }
}

export const ERR = {
  INVALID_PARAM: 1001,
  UNAUTHORIZED: 1002,
  TOO_MANY_REQUESTS: 1004,
  INTERNAL: 1005
};
