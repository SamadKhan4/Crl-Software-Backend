import { attendanceSummary } from "./attendance.service.js";
import { leaveDeduction } from "../utils/attendance.js";
import { resolveHrEmployee } from "./hr-employee.service.js";
import { Payslip } from "../models/index.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const amount = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const total = (parts) => amount(Object.values(parts || {}).reduce((sum, value) => sum + Number(value || 0), 0));
const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });

export async function createPayslip(data, req) {
  const { employee, employeeModel } = await resolveHrEmployee(data.employeeId);
  data = { ...data, employeeId: employee._id };
  const grossEarnings = total(data.earnings);
  const summary = await attendanceSummary(data.employeeId, data.salaryMonth);
  if (summary.missingDays) throw new ConflictError(`Complete attendance for ${summary.missingDays} working days before creating this payslip`, "ATTENDANCE_INCOMPLETE");
  const deductions = { ...data.deductions, leave: leaveDeduction(grossEarnings, summary) };
  const totalDeductions = total(deductions);
  if (totalDeductions > grossEarnings)
    throw new ConflictError("Deductions cannot exceed gross earnings", "INVALID_DEDUCTIONS");
  try {
    const payslip = await Payslip.create({
      ...data,
      branchId: employee.branchId, employeeModel,
      paidDays: summary.paidDays, deductions,
      attendanceSummary: { workingDays: summary.workingDays, eligibleDays: summary.eligibleDays, unpaidDays: summary.unpaidDays, paidLeaveDays: summary.paidLeaveDays, paidDays: summary.paidDays },
      payslipNumber: await generateBusinessNumber("payslip", "PAY"),
      grossEarnings,
      totalDeductions,
      netPay: amount(grossEarnings - totalDeductions),
      createdBy: req.user._id,
    });
    await audit(null, req, "PAYSLIP_CREATED", "Payslip", payslip._id, null, {
      payslipNumber: payslip.payslipNumber,
      employeeId: payslip.employeeId,
      salaryMonth: payslip.salaryMonth,
      netPay: payslip.netPay,
    });
    return getPayslip(payslip._id);
  } catch (error) {
    if (error.code === 11000)
      throw new ConflictError("Payslip already exists for this employee and month", "PAYSLIP_EXISTS");
    throw error;
  }
}

export async function listPayslips(query) {
  const options = listQuery(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.salaryMonth) filter.salaryMonth = query.salaryMonth;
  if (query.search) filter.$or = ["payslipNumber", "designation", "department", "paymentReference"].map((field) => ({
    [field]: { $regex: escapeSearch(query.search), $options: "i" },
  }));
  const [items, count] = await Promise.all([
    Payslip.find(filter).populate("employeeId", "employeeCode name email mobile").populate("branchId", "branchCode name city").sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    Payslip.countDocuments(filter),
  ]);
  return paginated(items.map(dto), count, options);
}

export async function getPayslip(id) {
  const payslip = await Payslip.findById(id)
    .populate("employeeId", "employeeCode name email mobile")
    .populate("branchId", "branchCode name city address state pincode");
  if (!payslip) throw new NotFoundError("Payslip not found", "PAYSLIP_NOT_FOUND");
  return dto(payslip);
}

export async function updatePayslipStatus(id, status, req) {
  const payslip = await Payslip.findById(id);
  if (!payslip) throw new NotFoundError("Payslip not found", "PAYSLIP_NOT_FOUND");
  if (payslip.status !== "DRAFT")
    throw new ConflictError("Only draft payslips can be issued or cancelled", "PAYSLIP_FINALIZED");
  const before = payslip.status;
  payslip.status = status;
  await payslip.save();
  await audit(null, req, "PAYSLIP_STATUS_UPDATED", "Payslip", payslip._id, { status: before }, { status });
  return getPayslip(id);
}
