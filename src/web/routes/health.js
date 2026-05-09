export async function registerHealthRoutes(app) {
  app.get('/api/health', async () => {
    return { ok: true, ts: Date.now() };
  });
}
