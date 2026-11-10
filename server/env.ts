// Imported first so .env is loaded before other modules read process.env.
// ENV_FILE picks another file, e.g. ENV_FILE=.env.dev for a test Supabase project, leaving .env as it is.
try {
  process.loadEnvFile(process.env.ENV_FILE ?? ".env");
} catch {
  // no such file — that's fine
}
