import { attendanceSummary } from "../src/services/attendance.service.js";
import { listHrEmployees, resolveHrEmployee } from "../src/services/hr-employee.service.js";
import { jest } from "@jest/globals";
import { calculateAttendance, leaveDeduction } from "../src/utils/attendance.js";
import { createPayslip } from "../src/services/payslip.service.js";
import { createOnboarding } from "../src/services/onboarding.service.js";
import { Attendance, Holiday, EmployeeOnboarding, User, Payslip, Branch, Counter, AuditLog } from "../src/models/index.js";
afterEach(() => jest.restoreAllMocks());
const month = "2026-10";
const markAll = () => Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, status: "PRESENT" }));
test("Sundays and mapped holidays never cause a leave deduction", () => {
  const records = markAll().map((row) => ["2026-10-04", "2026-10-02", "2026-10-05"].includes(row.date) ? { ...row, status: "UNPAID_LEAVE" } : row);
  records.find((row) => row.date === "2026-10-06").status = "PAID_LEAVE";
  const summary = calculateAttendance(month, records, [{ date: "2026-10-02", name: "Holiday" }]);
  expect(summary).toMatchObject({ workingDays: 26, unpaidDays: 1, paidLeaveDays: 1, paidDays: 25, missingDays: 0 });
  expect(leaveDeduction(26000, summary)).toBe(1000);
});
test("counts half days and absent days, with unmarked days automatically present", () => {
  const summary = calculateAttendance(month, [{ date: "2026-10-01", status: "HALF_DAY" }, { date: "2026-10-02", status: "ABSENT" }], []);
  expect(summary.unpaidDays).toBe(1.5);
  expect(summary.missingDays).toBe(0);
  expect(summary.calendar.find((row) => row.date === "2026-10-03").status).toBe("PRESENT");
});
test("a Sunday holiday is excluded only once and leap-year February has 29 calendar days", () => {
  const summary = calculateAttendance("2024-02", [], [{ date: "2024-02-04", name: "Holiday" }]);
  expect(summary.calendar).toHaveLength(29);
  expect(summary.workingDays).toBe(25);
});
test("joining mid-month excludes earlier attendance and prorates working days", () => {
  const summary = calculateAttendance(month, markAll(), [], "2026-10-15");
  expect(summary.eligibleDays).toBeLessThan(summary.workingDays);
  expect(summary.missingDays).toBe(0);
  expect(summary.calendar[0].eligible).toBe(false);
  expect(leaveDeduction(27000, summary)).toBe((summary.workingDays - summary.paidDays) * 1000);
});
function payroll(records) {
  jest.spyOn(User, "findOne").mockResolvedValue({ _id: "emp", branchId: "branch" });
  jest.spyOn(Attendance, "find").mockReturnValue({ lean: async () => records });
  jest.spyOn(Holiday, "find").mockReturnValue({ lean: async () => [{ date: "2026-10-02", name: "Holiday" }] });
  jest.spyOn(EmployeeOnboarding, "findOne").mockReturnValue({ lean: async () => null });
}
test("unmarked working days are paid as present without manual entries", async () => {
  payroll([]);
  const result = await attendanceSummary("emp", month);
  expect(result).toMatchObject({ missingDays: 0, unpaidDays: 0, paidDays: 26 });
  expect(result.calendar[0].status).toBe("PRESENT");
});
test("payslip recalculates leave and net pay on the server and stores the attendance snapshot", async () => {
  const records = markAll();
  records.find((row) => row.date === "2026-10-05").status = "ABSENT";
  payroll(records);
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 1 });
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  const create = jest.spyOn(Payslip, "create").mockResolvedValue({ _id: "pay" });
  const chain = { populate: () => chain, then: (resolve) => resolve({ _id: "pay" }) };
  jest.spyOn(Payslip, "findById").mockReturnValue(chain);
  await createPayslip({ employeeId: "emp", salaryMonth: month, paidDays: 31, earnings: { basic: 26000 }, deductions: { pf: 500 } }, { user: { _id: "hr" }, get: () => "test" });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ paidDays: 25, deductions: { pf: 500, leave: 1000 }, grossEarnings: 26000, totalDeductions: 1500, netPay: 24500, attendanceSummary: expect.objectContaining({ unpaidDays: 1, workingDays: 26 }) }));
});
test("employee ID is allocated at onboarding before login approval", async () => {
  jest.spyOn(Branch, "exists").mockResolvedValue(true);
  jest.spyOn(User, "exists").mockReturnValue({ session: async () => false, then: (resolve) => resolve(false) });
  jest.spyOn(EmployeeOnboarding, "exists").mockResolvedValue(false);
  jest.spyOn(Counter, "findOneAndUpdate").mockResolvedValue({ value: 7 });
  const create = jest.spyOn(EmployeeOnboarding, "create").mockResolvedValue({ _id: "onboard" });
  jest.spyOn(AuditLog, "create").mockResolvedValue([]);
  await createOnboarding({ email: "employee@example.com", branchId: "branch", name: "Employee" }, { user: { _id: "hr" }, get: () => "test" });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ employeeCode: expect.stringMatching(/^CRLEMP0*7$/) }));
});


test("employee directory counts onboarded employees without logins exactly once", async () => {
  jest.spyOn(User, "find").mockReturnValue({ select: () => ({ lean: async () => [{ _id: "user", name: "Active Employee", employeeCode: "CRLEMP1" }] }) });
  const find = jest.spyOn(EmployeeOnboarding, "find").mockReturnValue({ select: () => ({ lean: async () => [{ _id: "pending", name: "Pending Employee", employeeCode: "CRLEMP2" }] }) });
  const result = await listHrEmployees({});
  expect(result.pagination.total).toBe(2);
  expect(result.items.map((row) => row.id)).toEqual(["user", "pending"]);
  expect(find).toHaveBeenCalledWith({ status: { $ne: "REJECTED" }, userId: null });
  expect((await listHrEmployees({ search: "CRLEMP2" })).items).toHaveLength(1);
});
test("attendance and payroll resolve an onboarded employee without creating a login", async () => {
  jest.spyOn(User, "findOne").mockResolvedValue(null);
  const employee = { _id: "pending", name: "Pending", employeeCode: "CRLEMP2", joiningDate: "2026-10-01" };
  jest.spyOn(EmployeeOnboarding, "findOne").mockResolvedValue(employee);
  expect(await resolveHrEmployee("pending")).toEqual({ employee, employeeModel: "EmployeeOnboarding" });
  jest.spyOn(Attendance, "find").mockReturnValue({ lean: async () => [] });
  jest.spyOn(Holiday, "find").mockReturnValue({ lean: async () => [] });
  expect(await attendanceSummary("pending", month)).toMatchObject({ employeeId: "pending", paidDays: 27, unpaidDays: 0 });
});
