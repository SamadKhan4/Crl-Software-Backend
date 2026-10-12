import { Branch } from "../models/branch.model.js";
import { isBranchScopedEmployee } from "../utils/access.js";
import { AuthorizationError } from "../utils/errors.js";

// Keep required legacy references internal; route cities never come from this record.
export async function operationsOffice(user) {
  if (isBranchScopedEmployee(user)) {
    const branch = user.branchId && await Branch.findOne({ _id: user.branchId, status: "ACTIVE" });
    if (!branch) throw new AuthorizationError("An active assigned branch is required");
    return branch;
  }
  const existing = await Branch.findOne({ branchCode: "NGP" });
  if (existing) return existing;
  try {
    return await Branch.findOneAndUpdate(
    { branchCode: "NGP" },
    { $setOnInsert: { name: "Nagpur", city: "Nagpur", state: "Maharashtra", status: "ACTIVE" } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    // Two first requests may provision the internal office simultaneously.
    if (error.code === 11000) {
      const office = await Branch.findOne({ branchCode: "NGP" });
      if (office) return office;
    }
    throw error;
  }
}
