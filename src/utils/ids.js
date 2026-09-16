import { Counter } from "../models/index.js";

const nextSequence = async (key, session) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { key },
        { $inc: { value: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session },
      );
      return counter.value;
    } catch (error) {
      if (error?.code !== 11000 || attempt === 2) throw error;
    }
  }
  throw new Error("Unable to allocate sequence");
};

const padded = (sequence) => String(sequence).padStart(6, "0");

export const generateCustomerCode = async (session) => {
  const sequence = await nextSequence("customer", session);
  if (sequence > 99999) throw new Error("Customer code limit reached");
  return String(sequence).padStart(5, "0");
};
export const generateEmployeeCode = async (session) => `CRLEMP${padded(await nextSequence("employee", session))}`;
