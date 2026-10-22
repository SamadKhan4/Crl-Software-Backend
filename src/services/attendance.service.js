import { Attendance, Holiday, EmployeeOnboarding } from "../models/index.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { resolveHrEmployee } from "./hr-employee.service.js";
import { calculateAttendance } from "../utils/attendance.js";
import { audit } from "./audit.service.js";
export async function attendanceSummary(employeeId, month) {
  const { employee, employeeModel } = await resolveHrEmployee(employeeId);
  employeeId = employee._id;
  const range = { $gte: `${month}-01`, $lte: `${month}-31` };
  const [records, holidays, onboarding] = await Promise.all([
    Attendance.find({ employeeId, date: range }).lean(), Holiday.find({ date: range }).lean(),
    employeeModel === "EmployeeOnboarding" ? employee : EmployeeOnboarding.findOne({ userId: employeeId }).lean(),
  ]);
  return { employeeId, month, ...calculateAttendance(month, records, holidays, onboarding?.joiningDate) };
}
export async function saveAttendance(data, req) {
  const month = data.date.slice(0, 7);
  const summary = await attendanceSummary(data.employeeId, month);
  const day = summary.calendar.find((item) => item.date === data.date);
  if (!day?.eligible) throw new ConflictError("Attendance date is before the employee joining date", "INVALID_ATTENDANCE_DATE");
  const row = await Attendance.findOneAndUpdate({ employeeId: summary.employeeId, date: data.date }, { $set: { ...data, employeeId: summary.employeeId, updatedBy: req.user._id } }, { new: true, upsert: true, runValidators: true });
  await audit(null, req, "ATTENDANCE_SAVED", "Attendance", row._id, null, data);
  return row;
}
export const listHolidays = (month) => Holiday.find({ date: { $gte: `${month}-01`, $lte: `${month}-31` } }).sort({ date: 1 }).lean();
export async function saveHoliday(data, req) {
  const row = await Holiday.findOneAndUpdate({ date: data.date }, { $set: { ...data, updatedBy: req.user._id } }, { new: true, upsert: true, runValidators: true });
  await audit(null, req, "HOLIDAY_SAVED", "Holiday", row._id, null, data);
  return row;
}
export async function deleteHoliday(date, req) {
  const row = await Holiday.findOneAndDelete({ date });
  if (!row) throw new NotFoundError("Holiday not found", "HOLIDAY_NOT_FOUND");
  await audit(null, req, "HOLIDAY_REMOVED", "Holiday", row._id, { date, name: row.name }, null);
  return { date };
}
