module.exports = {
  server: {
    command: 'npm run dev -- --port 5173 --strictPort',
    port: 5173,
    launchTimeout: 30000,
    debug: true,
  },
  launch: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  browserContext: 'default',
};
