const nextDay = [
  "Gondia",
  "Tiroda",
  "Tumsar",
  "Bhandara",
  "Sakoli",
  "Umred",
  "Nagbhid",
  "Bhivapur",
  "Bhramhapuri",
  "Gadchiroli",
  "Hinganghat",
  "Wani",
  "Bhadrawati",
  "Warora",
  "Chandrapur",
  "Wardha",
  "Yavatmal",
  "Katol",
  "Sawner",
  "Warud",
  "Amravati",
  "Akot",
  "Akola",
  "Murtizapur",
];

const longDistance = [
  ["Shegaon", 2],
  ["Khamgaon", 2],
  ["Washim", 2],
  ["Buldhana", 2],
  ["Jalna", 3],
  ["Jalgaon", 3],
  ["Nashik", 3],
  ["Thane", 3],
  ["Bhiwandi", 3],
  ["Kalyan", 4],
  ["Vasai", 4],
  ["Pune", 4],
  ["Aurangabad", 3],
];

export const SERVICE_LOCATIONS = Object.freeze([
  ...nextDay.map((location) => Object.freeze({ location, transitDays: 1, serviceLevel: "NEXT_DAY" })),
  ...longDistance.map(([location, transitDays]) =>
    Object.freeze({ location, transitDays, serviceLevel: "LONG_DISTANCE" }),
  ),
]);

export const SERVICE_LOCATION_NAMES = Object.freeze(SERVICE_LOCATIONS.map(({ location }) => location));

export const normalizeServiceLocation = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function findCustomerLocationRate(rateCard = [], destination = "") {
  const normalizedDestination = normalizeServiceLocation(destination);
  return rateCard.find(({ location }) => {
    const normalizedLocation = normalizeServiceLocation(location);
    return (
      normalizedDestination === normalizedLocation ||
      normalizedDestination.startsWith(`${normalizedLocation} `)
    );
  });
}
