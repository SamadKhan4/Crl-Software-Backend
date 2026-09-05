import { ACTIVE, ROLES } from "../constants/workflow.js";
import { Branch } from "../models/index.js";
import { AuthorizationError, ConflictError, NotFoundError } from "../utils/errors.js";
import { listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const find = async (id) => {
  const branch = await Branch.findById(id);
  if (!branch) throw new NotFoundError("Branch not found", "BRANCH_NOT_FOUND");
  return branch;
};
const dto = (branch) => ({ ...(branch.toObject?.() ?? branch), id: branch._id });
const assertAdmin = (req) => {
  if (req.user.role !== ROLES.ADMIN) throw new AuthorizationError("Only administrators can modify branches");
};
export async function createBranch(data, req) {
  assertAdmin(req);
  try {
    const branch = await Branch.create(data);
    await audit(null, req, "BRANCH_CREATED", "Branch", branch._id, null, branch.toObject());
    return dto(branch);
  } catch (error) {
    if (error.code === 11000) throw new ConflictError("Branch code already exists", "BRANCH_CODE_EXISTS");
    throw error;
  }
}
export async function listBranches(query, user) {
  const options = listQuery(query);
  const filter = user.role === ROLES.ADMIN ? {} : { _id: user.branchId };
  if (query.status) filter.status = query.status;
  if (query.search)
    filter.$or = ["branchCode", "name", "city"].map((field) => ({ [field]: { $regex: query.search, $options: "i" } }));
  const [items, total] = await Promise.all([
    Branch.find(filter).sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    Branch.countDocuments(filter),
  ]);
  return paginated(items.map(dto), total, options);
}
export async function getBranch(id, user) {
  if (user.role !== ROLES.ADMIN && user.branchId?.toString() !== id)
    throw new AuthorizationError("You can only access your assigned branch");
  return dto(await find(id));
}
export async function updateBranch(id, data, req) {
  assertAdmin(req);
  const branch = await find(id);
  const before = branch.toObject();
  Object.assign(branch, data);
  await branch.save();
  await audit(null, req, "BRANCH_UPDATED", "Branch", id, before, branch.toObject());
  return dto(branch);
}
export async function setBranchStatus(id, status, req) {
  assertAdmin(req);
  const branch = await find(id);
  const before = branch.toObject();
  branch.status = status;
  await branch.save();
  await audit(
    null,
    req,
    status === ACTIVE.INACTIVE ? "BRANCH_DISABLED" : "BRANCH_ENABLED",
    "Branch",
    id,
    before,
    branch.toObject(),
  );
  return dto(branch);
}
