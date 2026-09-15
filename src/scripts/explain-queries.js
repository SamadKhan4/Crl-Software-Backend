import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { Shipment, AuditLog, User } from "../models/index.js";

const run = async () => {
  await connectDatabase({ autoIndex: false, autoCreate: false });
  const [shipment, actor] = await Promise.all([
    Shipment.findOne().select("originBranchId").lean(),
    User.findOne({ branchId: { $exists: true } })
      .select("branchId")
      .lean(),
  ]);
  const cases = [
    ["recent_shipments", Shipment, {}],
    ["recent_activity", AuditLog, {}],
    ...(shipment ? [["origin_shipments", Shipment, { originBranchId: shipment.originBranchId }]] : []),
    ...(actor ? [["branch_employees", User, { role: "EMPLOYEE", branchId: actor.branchId }]] : []),
  ];
  for (const [name, model, filter] of cases) {
    const result = await model.find(filter).sort({ createdAt: -1, _id: -1 }).limit(20).explain("executionStats");
    console.log(
      JSON.stringify({
        name,
        returned: result.executionStats.nReturned,
        documentsExamined: result.executionStats.totalDocsExamined,
        keysExamined: result.executionStats.totalKeysExamined,
        plan: result.queryPlanner.winningPlan,
      }),
    );
  }
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
