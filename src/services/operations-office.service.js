import { Branch } from "../models/branch.model.js";

// Keep required legacy references internal; route cities never come from this record.
export async function operationsOffice() {
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
