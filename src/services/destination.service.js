const cache = new Map();
const fallback = [
  ["Nagpur GPO", "Nagpur", "440001"], ["Amravati HO", "Amravati", "444601"], ["Akola HO", "Akola", "444001"],
  ["Wardha HO", "Wardha", "442001"], ["Bhandara HO", "Bhandara", "441904"], ["Gondia HO", "Gondia", "441601"],
  ["Chandrapur HO", "Chandrapur", "442401"], ["Gadchiroli HO", "Gadchiroli", "442605"], ["Washim HO", "Washim", "444505"],
  ["Yavatmal HO", "Yavatmal", "445001"], ["Buldhana HO", "Buldhana", "443001"],
].map(([name, district, pincode]) => ({ id: `${pincode}:${name}`, name, district, pincode }));

const localMatches = (term) => fallback.filter((place) =>
  `${place.name} ${place.district} ${place.pincode}`.toLowerCase().includes(term.toLowerCase()),
).slice(0, 3);

export async function searchDestinations(search) {
  const term = search.trim();
  if (term.length < 2) return fallback.slice(0, 3);
  if (cache.has(term.toLowerCase())) return cache.get(term.toLowerCase());
  const type = /^\d{6}$/.test(term) ? "pincode" : "postoffice";
  let places = [];
  try {
    const response = await fetch(`https://api.postalpincode.in/${type}/${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(6000) });
    if (response.ok) {
      const body = await response.json();
      places = (body[0]?.PostOffice || [])
        .map((place) => ({ id: `${place.Pincode}:${place.Name}`, name: place.Name, district: place.District, pincode: place.Pincode }))
        .slice(0, 3);
    }
  } catch {
    places = [];
  }
  if (!places.length) places = localMatches(term);
  cache.set(term.toLowerCase(), places);
  return places;
}
