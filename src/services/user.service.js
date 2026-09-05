import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { ACTIVE, ROLES } from "../constants/workflow.js";
import { Branch, RefreshToken, User } from "../models/index.js";
import { AuthorizationError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateEmployeeCode } from "../utils/ids.js";
import { listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

export const userDto = (user) => ({
  id: user._id,
  employeeCode: user.employeeCode,
  name: user.name,
  email: user.email,
  mobile: user.mobile,
  role: user.role,
  branchId: user.branchId,
  status: user.status,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const activeBranch = async (branchId, session) => {
  const branch = await Branch.findOne({ _id: branchId, status: ACTIVE.ACTIVE }).session(session);
  if (!branch) throw new NotFoundError("Active branch not found", "BRANCH_NOT_FOUND");
  return branch;
};

const findUser = async (id) => {
  const user = await User.findById(id);
  if (!user) throw new NotFoundError("Employee not found", "USER_NOT_FOUND");
  return user;
};

export async function createEmployee(data, req) {
  const session = await mongoose.startSession();
  try {
    let user;
    await session.withTransaction(async () => {
      await activeBranch(data.branchId, session);
      user = (
        await User.create(
          [
            {
              ...data,
              employeeCode: await generateEmployeeCode(session),
              passwordHash: await bcrypt.hash(data.password, 12),
              role: ROLES.EMPLOYEE,
            },
          ],
          { session },
        )
      )[0];
      await audit(session, req, "USER_CREATED", "User", user._id, null, userDto(user));
    });
    return userDto(user);
  } catch (error) {
    if (error.code === 11000)
      throw new ConflictError(
        error.keyPattern?.employeeCode ? "Employee code already exists" : "Employee email already exists",
        error.keyPattern?.employeeCode ? "EMPLOYEE_CODE_EXISTS" : "USER_EMAIL_EXISTS",
      );
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function listEmployees(query) {
  const options = listQuery(query);
  const filter = { role: ROLES.EMPLOYEE };
  if (query.status) filter.status = query.status;
  if (query.search)
    filter.$or = ["employeeCode", "name", "email", "mobile"].map((field) => ({
      [field]: { $regex: query.search, $options: "i" },
    }));
  const [items, total] = await Promise.all([
    User.find(filter)
      .select("-passwordHash")
      .populate("branchId", "branchCode name city")
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return paginated(items.map(userDto), total, options);
}

export async function getEmployee(id) {
  const user = await User.findOne({ _id: id, role: ROLES.EMPLOYEE })
    .select("-passwordHash")
    .populate("branchId", "branchCode name city")
    .lean();
  if (!user) throw new NotFoundError("Employee not found", "USER_NOT_FOUND");
  return userDto(user);
}

export async function updateEmployee(id, data, req) {
  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const user = await findUser(id);
      if (user.role !== ROLES.EMPLOYEE)
        throw new AuthorizationError("Administrator accounts cannot be modified through employee management");
      if (data.branchId) await activeBranch(data.branchId, session);
      const before = userDto(user);
      Object.assign(user, data);
      await user.save({ session });
      updated = userDto(user);
      await audit(session, req, "USER_UPDATED", "User", id, before, updated);
    });
    return updated;
  } catch (error) {
    if (error.code === 11000) throw new ConflictError("Employee email already exists", "USER_EMAIL_EXISTS");
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function setEmployeeStatus(id, status, req) {
  const user = await findUser(id);
  if (user.role !== ROLES.EMPLOYEE)
    throw new AuthorizationError("Administrator accounts cannot be disabled through employee management");
  const before = userDto(user);
  user.status = status;
  await user.save();
  if (status === ACTIVE.INACTIVE)
    await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await audit(
    null,
    req,
    status === ACTIVE.INACTIVE ? "USER_DISABLED" : "USER_ENABLED",
    "User",
    user._id,
    before,
    userDto(user),
  );
  return userDto(user);
}

export async function resetEmployeePassword(id, newPassword, req) {
  const user = await findUser(id);
  if (user.role !== ROLES.EMPLOYEE)
    throw new AuthorizationError("Administrator passwords cannot be reset through employee management");
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await audit(null, req, "PASSWORD_RESET", "User", user._id, null, { reset: true });
}
