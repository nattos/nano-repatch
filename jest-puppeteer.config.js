module.exports = {
  server: {
    command: 'npm run dev -- --port 4173 --strictPort',
    port: 4173,
    launchTimeout: 5000,
    debug: true,
  },
  launch: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  browserContext: 'default',
};
