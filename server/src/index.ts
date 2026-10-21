// Load project singletons only inside a backend process. The gateway has its own control DB.
if (process.env.CONSOLE_PROJECT_CHILD === '1') {
  await import('./app.js');
} else {
  const { loadProjects } = await import('./projects.js');
  const setup = loadProjects(process.env);
  process.env.DB_PATH = setup.controlDbPath;
  const { startGateway } = await import('./project-gateway.js');
  await startGateway(setup);
}
export {};
