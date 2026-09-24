import "dotenv/config";

// Vor dem ersten Import von src/server/db.ts auf die Test-Datenbank umstellen.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
