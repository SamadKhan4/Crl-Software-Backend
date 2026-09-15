import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
const start = async () => {
  await connectDatabase();
  const app = createApp();
  const server = app.listen(env.port, () => console.log(`CRL API listening on port ${env.port}`));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    app.locals.draining = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, env.shutdownTimeoutMs);
    deadline.unref();
    server.close(async () => {
      try {
        await disconnectDatabase();
        clearTimeout(deadline);
        process.exit(0);
      } catch (error) {
        console.error("Database shutdown failed", error.message);
        process.exit(1);
      }
    });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};
start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
