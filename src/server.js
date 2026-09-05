import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
const start = async () => {
  await connectDatabase();
  const server = createApp().listen(env.port, () => console.log(`CRL API listening on port ${env.port}`));
  const shutdown = async () => {
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};
start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
