export const chargeFields = ['freightCharges', 'fuelCharges', 'handlingCharges', 'fodCharges', 'codCharges', 'rovCharges', 'docketCharges'];

export function calculateCharges(details = {}) {
  const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const legacy = details.fodCharges == null && details.codCharges == null ? Number(details.fodCodCharges || 0) : 0;
  const subtotal = money(chargeFields.reduce((sum, key) => sum + Number(details[key] || 0), legacy));
  const gstAmount = money(subtotal * Number(details.gstRate || 0) / 100);
  return { gstAmount, totalAmount: money(subtotal + gstAmount) };
}
