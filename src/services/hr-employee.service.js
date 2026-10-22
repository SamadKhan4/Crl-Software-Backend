import { User, EmployeeOnboarding } from "../models/index.js";
import { NotFoundError } from "../utils/errors.js";
import { listQuery, paginated } from "../utils/query.js";
export async function resolveHrEmployee(employeeId) {
  const user = await User.findOne({ _id: employeeId, role: "EMPLOYEE", status: "ACTIVE" });
  if (user) return { employee: user, employeeModel: "User" };
  const onboarding = await EmployeeOnboarding.findOne({ _id: employeeId, status: { $ne: "REJECTED" } });
  if (!onboarding) throw new NotFoundError("Employee not found", "EMPLOYEE_NOT_FOUND");
  if (onboarding.userId) return resolveHrEmployee(onboarding.userId);
  return { employee: onboarding, employeeModel: "EmployeeOnboarding" };
}
export async function listHrEmployees(query) {
  const options = listQuery(query);
  const [users, onboardings] = await Promise.all([
    User.find({ role: "EMPLOYEE", status: "ACTIVE" }).select("employeeCode name email mobile branchId").lean(),
    EmployeeOnboarding.find({ status: { $ne: "REJECTED" }, userId: null }).select("employeeCode onboardingNumber name email mobile branchId joiningDate").lean(),
  ]);
  const term = (query.search || "").trim().toLowerCase();
  const employees = [...users, ...onboardings].map((row) => ({ ...row, id: row._id, role: "EMPLOYEE" }))
    .filter((row) => !term || [row.employeeCode, row.onboardingNumber, row.name, row.email, row.mobile].some((value) => String(value || "").toLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return paginated(employees.slice(options.skip, options.skip + options.limit), employees.length, options);
}
