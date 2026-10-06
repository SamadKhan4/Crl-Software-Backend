export const locationKey = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
export const sameLocation = (a, b) => Boolean(locationKey(a)) && locationKey(a) === locationKey(b);
export const shipmentDestination = (shipment) => {
  const branch = shipment.destinationBranchId;
  const destination = shipment.lrDetails?.to;
  // Historical LRs sometimes stored the office name in the city field.
  if (branch?.city && sameLocation(destination, branch.name)) return branch.city;
  return destination || branch?.city || branch?.name || "";
};
