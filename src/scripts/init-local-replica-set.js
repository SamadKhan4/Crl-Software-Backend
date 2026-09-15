import mongoose from "mongoose";

// Local development only: never uses the application's configured production URI.
try {
  await mongoose.connect("mongodb://127.0.0.1:27017/admin?directConnection=true", {
    serverSelectionTimeoutMS: 10000,
  });
  const admin = mongoose.connection.db.admin();
  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    if (status.set !== "rs0") throw new Error("Existing replica set is not rs0; configuration was not changed.");
  } catch (error) {
    if (error.code !== 94) throw error;
    await admin.command({ replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] } });
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const hello = await admin.command({ hello: 1 });
    if (hello.setName === "rs0" && hello.isWritablePrimary) {
      console.log("Local MongoDB rs0 is ready for transactions. Existing application data is preserved.");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const hello = await admin.command({ hello: 1 });
  if (!hello.isWritablePrimary) throw new Error("Replica set did not become primary within 30 seconds.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
