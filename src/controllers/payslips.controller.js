import { asyncHandler } from "../utils/asyncHandler.js";
import { success, successPaginated } from "../utils/response.js";
import * as payslips from "../services/payslip.service.js";

export const create = asyncHandler(async (req, res) =>
  success(res, 201, "Payslip created", await payslips.createPayslip(req.body, req)),
);
export const list = asyncHandler(async (req, res) =>
  successPaginated(res, "Payslips fetched", await payslips.listPayslips(req.query)),
);
export const get = asyncHandler(async (req, res) =>
  success(res, 200, "Payslip fetched", await payslips.getPayslip(req.params.id)),
);
export const status = asyncHandler(async (req, res) =>
  success(res, 200, "Payslip status updated", await payslips.updatePayslipStatus(req.params.id, req.body.status, req)),
);
