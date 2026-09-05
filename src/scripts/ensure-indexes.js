import { connectDatabase, disconnectDatabase } from "../config/db.js";
import * as models from "../models/index.js";

const run = async () => {
  await connectDatabase();
  const collections = Object.values(models).filter((model) => typeof model?.syncIndexes === "function");
  await Promise.all(collections.map((model) => model.syncIndexes()));
  console.log(`Indexes synchronized for ${collections.length} collections.`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
