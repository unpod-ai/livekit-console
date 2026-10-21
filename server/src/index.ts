// Migrate accounts/audit before importing routes that accept authenticated requests.
const { migrateLegacyControl } = await import('./single-server-migration.js');
migrateLegacyControl();
await import('./app.js');
export {};
