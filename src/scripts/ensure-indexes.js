import { connectDatabase, disconnectDatabase } from "../config/db.js";
import * as models from "../models/index.js";

const run = async () => {
  await connectDatabase({ autoIndex: false, autoCreate: false });
  const collections = Object.values(models).filter((model) => typeof model?.createIndexes === "function");
  const checkOnly = process.argv.includes("--check");
  // Build sequentially to avoid competing index builds on a busy database.
  for (const model of collections) {
    if (checkOnly) {
      const difference = await model.diffIndexes();
      console.log(
        JSON.stringify({
          model: model.modelName,
          create: difference.toCreate,
          retainedExtraIndexes: difference.toDrop,
        }),
      );
    } else {
      await model.createIndexes();
      console.log(`Indexes ensured for ${model.collection.name}; existing indexes retained.`);
    }
  }
  console.log(
    `${checkOnly ? "Checked" : "Ensured"} indexes for ${collections.length} collections. No indexes dropped.`,
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
