export function calculateCharges(details = {}) {
  const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const hasLrPricing = Boolean(details.freightBasis) || details.freightRate !== undefined;
  const freightUnits = details.freightBasis === 'PER_BOX'
    ? Number(details.packageCount || 0)
    : details.freightBasis === 'FIXED'
      ? 1
      : Number(details.chargedWeight || details.actualWeight || 0);
  const freightCharges = hasLrPricing
    ? money(Number(details.freightRate || 0) * freightUnits)
    : money(Number(details.freightCharges || 0));
  const fuelCharges = hasLrPricing
    ? money(freightCharges * Number(details.fuelRatePercent || 0) / 100)
    : money(Number(details.fuelCharges || 0));
  const rovCharges = hasLrPricing
    ? money(Number(details.declaredValue || 0) * Number(details.rovRatePercent || 0) / 100)
    : money(Number(details.rovCharges || 0));
  const legacy = details.fodCharges == null && details.codCharges == null ? Number(details.fodCodCharges || 0) : 0;
  const subtotal = money(
    freightCharges + fuelCharges + rovCharges + legacy
      + Number(details.handlingCharges || 0)
      + Number(details.fodCharges || 0)
      + Number(details.codCharges || 0)
      + Number(details.docketCharges || 0),
  );
  const gstAmount = money(subtotal * Number(details.gstRate || 0) / 100);
  return { freightCharges, fuelCharges, rovCharges, gstAmount, totalAmount: money(subtotal + gstAmount) };
}
