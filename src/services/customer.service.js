import mongoose from "mongoose";
import { ACTIVE } from "../constants/workflow.js";
import { SERVICE_LOCATIONS } from "../constants/service-locations.js";
import { Customer } from "../models/index.js";
import { BusinessRuleError, ConflictError, NotFoundError } from "../utils/errors.js";
import { generateCustomerCode } from "../utils/ids.js";
import { escapeSearch, listQuery, paginated } from "../utils/query.js";
import { audit } from "./audit.service.js";

const dto = (customer) => ({ ...(customer.toObject?.() ?? customer), id: customer._id });
const emptyCreditCharges = () => ({
  fuelRatePercent: 0,
  handlingCharges: 0,
  fodCharges: 0,
  codCharges: 0,
  rovRatePercent: 0,
  docketCharges: 0,
  gstRate: 0,
});
const normalizeCreditCharges = (customerType, charges = {}) =>
  customerType === "CREDIT" ? { ...emptyCreditCharges(), ...charges } : emptyCreditCharges();
const locationByName = new Map(SERVICE_LOCATIONS.map((row) => [row.location, row]));
const normalizeCreditRateCard = (customerType, rateCard = []) => {
  if (customerType !== "CREDIT") return [];
  if (!rateCard.length)
    throw new BusinessRuleError("Add at least one location rate for a credit customer", "CREDIT_RATE_REQUIRED");
  const locations = rateCard.map(({ location }) => location);
  if (new Set(locations).size !== locations.length)
    throw new BusinessRuleError("A location can only be added once", "DUPLICATE_CREDIT_LOCATION");
  return rateCard.map(({ location, ratePerKg }) => ({
    location,
    transitDays: locationByName.get(location)?.transitDays,
    ratePerKg,
  }));
};
const find = async (id) => {
  const customer = await Customer.findById(id);
  if (!customer) throw new NotFoundError("Customer not found", "CUSTOMER_NOT_FOUND");
  return customer;
};
export async function createCustomer(data, req) {
  data.creditRateCard = normalizeCreditRateCard(data.customerType, data.creditRateCard);
  data.creditCharges = normalizeCreditCharges(data.customerType, data.creditCharges);
  const session = await mongoose.startSession();
  try {
    let customer;
    await session.withTransaction(async () => {
      customer = (
        await Customer.create(
          [{ ...data, customerCode: await generateCustomerCode(session), createdBy: req.user._id }],
          { session },
        )
      )[0];
      await audit(session, req, "CUSTOMER_CREATED", "Customer", customer._id, null, dto(customer));
    });
    return dto(customer);
  } catch (error) {
    if (error.code === 11000) throw new ConflictError("Customer GST number already exists", "CUSTOMER_DUPLICATE");
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function listCustomers(query) {
  const options = listQuery(query);
  const filter = query.status ? { status: query.status } : {};
  if (query.search)
    filter.$or = ["customerCode", "name", "companyName", "mobile", "email", "gstNumber"].map((field) => ({
      [field]: { $regex: escapeSearch(query.search), $options: "i" },
    }));
  const [items, total] = await Promise.all([
    Customer.find(filter).sort(options.sort).skip(options.skip).limit(options.limit).lean(),
    Customer.countDocuments(filter),
  ]);
  return paginated(items, total, options);
}

export async function lookupCustomers(query) {
  const filter = { status: ACTIVE.ACTIVE };
  if (query.search)
    filter.$or = ["customerCode", "name", "companyName", "mobile"].map((field) => ({
      [field]: { $regex: escapeSearch(query.search), $options: "i" },
    }));
  return Customer.find(filter)
    .select("customerCode customerType name companyName mobile address pincode gstNumber creditRateCard creditCharges")
    .sort({ name: 1, _id: 1 })
    .limit(Math.min(Number(query.limit) || 3, 3))
    .lean();
}

export const getCustomer = async (id) => dto(await find(id));
export async function getCustomerByCode(customerCode) {
  const customer = await Customer.findOne({ customerCode, status: ACTIVE.ACTIVE }).lean();
  if (!customer) throw new NotFoundError("Customer not found", "CUSTOMER_NOT_FOUND");
  return customer;
}
export async function updateCustomer(id, data, req) {
  const customer = await find(id);
  const before = dto(customer);
  const customerType = data.customerType ?? customer.customerType;
  const rateCard = data.creditRateCard ?? customer.creditRateCard;
  data.creditRateCard = normalizeCreditRateCard(customerType, rateCard);
  data.creditCharges = normalizeCreditCharges(customerType, data.creditCharges ?? customer.creditCharges?.toObject?.() ?? customer.creditCharges);
  Object.assign(customer, data);
  await customer.save();
  await audit(null, req, "CUSTOMER_UPDATED", "Customer", id, before, dto(customer));
  return dto(customer);
}
export async function setCustomerStatus(id, status, req) {
  const customer = await find(id);
  const before = dto(customer);
  customer.status = status;
  await customer.save();
  await audit(
    null,
    req,
    status === ACTIVE.INACTIVE ? "CUSTOMER_DISABLED" : "CUSTOMER_ENABLED",
    "Customer",
    id,
    before,
    dto(customer),
  );
  return dto(customer);
}
