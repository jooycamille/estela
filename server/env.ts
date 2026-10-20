// Imported first so .env is loaded before other modules read process.env.
try {
  process.loadEnvFile();
} catch {
  // no .env file — that's fine
}
