import { SQL } from "bun";

const databaseUrl = Bun.env.DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Set it in your environment before starting the server.");
}

export const sql = new SQL(databaseUrl);
