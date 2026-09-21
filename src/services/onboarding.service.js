import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { ACTIVE, ROLES } from "../constants/workflow.js";
import { Branch, EmployeeOnboarding, User } from "../models/index.js";
import { AuthorizationError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber, generateEmployeeCode } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";
import { storageService } from "./storage.service.js";
import { userDto } from "./user.service.js";

const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });
const scope = (user) => user.role === ROLES.MANAGER ? { branchId: user.branchId } : {};
const assertAccess = (record, user) => {
  if (user.role === ROLES.MANAGER && String(record.branchId?._id ?? record.branchId) !== String(user.branchId))
    throw new AuthorizationError("This onboarding record belongs to another branch");
};

export async function createOnboarding(data, req) {
  if (!(await Branch.exists({ _id: data.branchId, status: ACTIVE.ACTIVE })))
    throw new NotFoundError("Active branch not found", "BRANCH_NOT_FOUND");
  if (await User.exists({ email: data.email.toLowerCase() }))
    throw new ConflictError("An employee login already uses this email", "USER_EMAIL_EXISTS");
  if (await EmployeeOnboarding.exists({ email: data.email.toLowerCase(), status: "PENDING_MANAGER" }))
    throw new ConflictError("This employee already has a pending onboarding request", "ONBOARDING_EXISTS");
  const record = await EmployeeOnboarding.create({
    ...data,
    onboardingNumber: await generateBusinessNumber("employee-onboarding", "ONB"),
    createdBy: req.user._id,
  });
  await audit(null, req, "EMPLOYEE_ONBOARDING_CREATED", "EmployeeOnboarding", record._id, null, {
    onboardingNumber: record.onboardingNumber, name: record.name, branchId: record.branchId,
  });
  return dto(record);
}

export async function listOnboarding(query, user) {
  const options = listQuery(query);
  const filter = { ...scope(user), ...(query.status && { status: query.status }), ...(query.branchId && user.role !== ROLES.MANAGER && { branchId: query.branchId }) };
  if (query.search) filter.$or = ["onboardingNumber", "name", "email", "mobile", "designation", "department"].map((field) => ({ [field]: { $regex: escapeSearch(query.search), $options: "i" } }));
  const [items, count] = await Promise.all([
    EmployeeOnboarding.find(filter).populate("branchId", "branchCode name city").populate("userId", "employeeCode name email").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    EmployeeOnboarding.countDocuments(filter),
  ]);
  return paginated(items.map(dto), count, options);
}

export async function getOnboarding(id, user, includeSecrets = false) {
  let query = EmployeeOnboarding.findById(id).populate("branchId", "branchCode name city").populate("userId", "employeeCode name email");
  if (includeSecrets) query = query.select("+documents.storageKey +documents.fileUrl");
  const record = await query;
  if (!record) throw new NotFoundError("Onboarding record not found", "ONBOARDING_NOT_FOUND");
  assertAccess(record, user);
  return record;
}

export async function uploadDocument(id, documentType, file, req) {
  if (!file) throw new ConflictError("Select a document to upload", "DOCUMENT_REQUIRED");
  const record = await getOnboarding(id, req.user, true);
  if (record.status !== "PENDING_MANAGER")
    throw new ConflictError("Documents can only be added while manager approval is pending", "ONBOARDING_FINALIZED");
  const stored = await storageService.saveDocument(record._id, `employee-${documentType.toLowerCase()}`, file);
  try {
    const previous = record.documents.find((document) => document.documentType === documentType);
    const previousStorageKey = previous?.storageKey;
    record.documents = record.documents.filter((document) => document.documentType !== documentType);
    record.documents.push({ documentType, ...stored });
    await record.save();
    if (previousStorageKey) await storageService.remove(previousStorageKey);
    await audit(null, req, "EMPLOYEE_DOCUMENT_UPLOADED", "EmployeeOnboarding", record._id, null, { documentType });
    return dto(record);
  } catch (error) {
    await storageService.remove(stored.storageKey);
    throw error;
  }
}

export async function openDocument(id, documentId, user) {
  const record = await getOnboarding(id, user, true);
  const document = record.documents.id(documentId);
  if (!document) throw new NotFoundError("Employee document not found", "DOCUMENT_NOT_FOUND");
  const source = await storageService.open(document.storageKey, document.fileUrl);
  return { ...source, originalFileName: document.originalFileName, mimeType: document.mimeType };
}

export async function reviewOnboarding(id, data, req) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const record = await EmployeeOnboarding.findById(id).select("+documents.storageKey +documents.fileUrl").session(session);
      if (!record) throw new NotFoundError("Onboarding record not found", "ONBOARDING_NOT_FOUND");
      assertAccess(record, req.user);
      if (record.status !== "PENDING_MANAGER") throw new ConflictError("Onboarding request is already finalized", "ONBOARDING_FINALIZED");
      if (data.action === "REJECT") {
        record.status = "REJECTED";
        record.managerRemarks = data.remarks;
      } else {
        if (!record.documents.length) throw new ConflictError("Upload at least one employee document before approval", "EMPLOYEE_DOCUMENT_REQUIRED");
        if (await User.exists({ email: record.email }).session(session))
          throw new ConflictError("An employee login already uses this email", "USER_EMAIL_EXISTS");
        const user = (await User.create([{
          employeeCode: await generateEmployeeCode(session), name: record.name, email: record.email,
          mobile: record.mobile, branchId: record.branchId, role: ROLES.EMPLOYEE,
          passwordHash: await bcrypt.hash(data.password, 12), status: ACTIVE.ACTIVE,
        }], { session }))[0];
        record.status = "APPROVED";
        record.userId = user._id;
        result = userDto(user);
      }
      record.reviewedBy = req.user._id;
      record.reviewedAt = new Date();
      record.managerRemarks = data.remarks;
      await record.save({ session });
      await audit(session, req, data.action === "APPROVE" ? "EMPLOYEE_ONBOARDING_APPROVED" : "EMPLOYEE_ONBOARDING_REJECTED", "EmployeeOnboarding", record._id, null, { status: record.status, userId: record.userId });
    });
    return { onboarding: dto(await getOnboarding(id, req.user)), employee: result || null };
  } finally {
    await session.endSession();
  }
}
