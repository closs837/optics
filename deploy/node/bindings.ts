import { runtimeDatabase } from './sqlite.mjs';

export const env = {
  get DB(): D1Database {
    return runtimeDatabase() as unknown as D1Database;
  },
  get APP_ORIGIN() {
    return process.env.APP_ORIGIN;
  },
};
