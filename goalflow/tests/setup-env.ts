// Integration tests use a dedicated database (never the dev database).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://goalflow:goalflow@localhost:5432/goalflow_test";
(process.env as Record<string, string>).NODE_ENV = "test";
