/**
 * Shared fatal process error handlers.
 * Import and call registerFatalHandlers() at the top of each entry point.
 */

function registerFatalHandlers() {
  process.on('unhandledRejection', (err) => {
    console.error('[FATAL] Unhandled rejection:', err);
  });

  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exit(1);
  });
}

module.exports = { registerFatalHandlers };
