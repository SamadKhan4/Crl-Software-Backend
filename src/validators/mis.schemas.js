import { z } from "zod";
export const reportKeys = ["godown-stock", "hub-in-transits", "drs-details", "invoice-details", "branch-outstanding", "customer-business", "branch-loa", "stock-ageing", "unbilled-details"];
const id = z.string().regex(/^[a-f\d]{24}$/i);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Invalid date");
export const misParams = z.object({ report: z.enum(reportKeys) });
export const misQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(), branch: id.optional(), destination: id.optional(), customer: id.optional(), employee: id.optional(),
  status: z.string().trim().max(40).optional(), vehicle: z.string().trim().max(30).optional(), bucket: z.string().max(40).optional(),
  dateFrom: day.optional(), dateTo: day.optional(), dueFrom: day.optional(), dueTo: day.optional(), billingFrom: day.optional(), billingTo: day.optional(),
  minDays: z.coerce.number().int().min(0).max(100000).optional(), threshold: z.coerce.number().int().min(0).max(100000).default(7),
  sortBy: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/).max(50).default("date"), sortOrder: z.enum(["asc", "desc"]).default("desc"),
}).superRefine((value, ctx) => {
  for (const [from, to] of [["dateFrom", "dateTo"], ["dueFrom", "dueTo"], ["billingFrom", "billingTo"]]) {
    if (value[from] && value[to] && value[from] > value[to]) ctx.addIssue({ code: "custom", path: [to], message: "End date must follow start date" });
  }
});
