import { ACTIVE, ROLES } from "../constants/workflow.js";
import { Payslip, User } from "../models/index.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { generateBusinessNumber } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const amount = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const total = (parts) => amount(Object.values(parts || {}).reduce((sum, value) => sum + Number(value || 0), 0));
const dto = (record) => ({ ...(record.toObject?.() ?? record), id: record._id });

const findEmployee = async (employeeId) => {
  const employee = await User.findOne({ _id: employeeId, role: ROLES.EMPLOYEE, status: ACTIVE.ACTIVE });
  if (!employee) throw new NotFoundError("Active employee not found", "EMPLOYEE_NOT_FOUND");
  return employee;
};

export async function createPayslip(data, req) {
  const employee = await findEmployee(data.employeeId);
  const grossEarnings = total(data.earnings);
  const totalDeductions = total(data.deductions);
  if (totalDeductions > grossEarnings)
    throw new ConflictError("Deductions cannot exceed gross earnings", "INVALID_DEDUCTIONS");
  try {
    const payslip = await Payslip.create({
      ...data,
      branchId: employee.branchId,
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
