/**
 * Cloudflare Edge Server Selection
 *
 * Maps client geolocation to the nearest Cloudflare edge datacenter.
 * Cloudflare operates 300+ edge locations worldwide. When the browser
 * fetches from speed.cloudflare.com, Anycast DNS routes to the nearest
 * edge automatically. This module provides:
 *
 * 1. Edge identification — which datacenter the client is hitting
 * 2. Distance estimation — for BDP (bandwidth-delay product) calculations
 * 3. Explicit region hints — passed to Cloudflare's speed test endpoints
 */

export interface EdgeLocation {
  id: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
}

// Major Cloudflare edge datacenters with coordinates.
// This is a representative subset — Cloudflare has 300+ edges but
// these cover the primary routing regions.
const CF_EDGES: EdgeLocation[] = [
  // Asia-Pacific
  { id: "NRT", city: "Tokyo", region: "Asia-Pacific", country: "JP", lat: 35.6762, lon: 139.6503 },
  { id: "KIX", city: "Osaka", region: "Asia-Pacific", country: "JP", lat: 34.6937, lon: 135.5023 },
  { id: "ICN", city: "Seoul", region: "Asia-Pacific", country: "KR", lat: 37.5665, lon: 126.978 },
  { id: "SIN", city: "Singapore", region: "Asia-Pacific", country: "SG", lat: 1.3521, lon: 103.8198 },
  { id: "HKG", city: "Hong Kong", region: "Asia-Pacific", country: "HK", lat: 22.3193, lon: 114.1694 },
  { id: "BOM", city: "Mumbai", region: "Asia-Pacific", country: "IN", lat: 19.076, lon: 72.8777 },
  { id: "DEL", city: "Delhi", region: "Asia-Pacific", country: "IN", lat: 28.7041, lon: 77.1025 },
  { id: "BLR", city: "Bangalore", region: "Asia-Pacific", country: "IN", lat: 12.9716, lon: 77.5946 },
  { id: "MAA", city: "Chennai", region: "Asia-Pacific", country: "IN", lat: 13.0827, lon: 80.2707 },
  { id: "CCU", city: "Kolkata", region: "Asia-Pacific", country: "IN", lat: 22.5726, lon: 88.3639 },
  { id: "SYD", city: "Sydney", region: "Asia-Pacific", country: "AU", lat: -33.8688, lon: 151.2093 },
  { id: "MEL", city: "Melbourne", region: "Asia-Pacific", country: "AU", lat: -37.8136, lon: 144.9631 },
  { id: "BKK", city: "Bangkok", region: "Asia-Pacific", country: "TH", lat: 13.7563, lon: 100.5018 },
  { id: "KUL", city: "Kuala Lumpur", region: "Asia-Pacific", country: "MY", lat: 3.139, lon: 101.6869 },
  { id: "JKT", city: "Jakarta", region: "Asia-Pacific", country: "ID", lat: -6.2088, lon: 106.8456 },
  { id: "TPE", city: "Taipei", region: "Asia-Pacific", country: "TW", lat: 25.033, lon: 121.5654 },
  { id: "CAN", city: "Guangzhou", region: "Asia-Pacific", country: "CN", lat: 23.1291, lon: 113.2644 },
  { id: "SHA", city: "Shanghai", region: "Asia-Pacific", country: "CN", lat: 31.2304, lon: 121.4737 },
  { id: "BOM2", city: "Mumbai-2", region: "Asia-Pacific", country: "IN", lat: 19.08, lon: 72.88 },
  { id: "HYD", city: "Hyderabad", region: "Asia-Pacific", country: "IN", lat: 17.385, lon: 78.4867 },

  // North America
  { id: "LAX", city: "Los Angeles", region: "North America", country: "US", lat: 33.9425, lon: -118.408 },
  { id: "SFO", city: "San Francisco", region: "North America", country: "US", lat: 37.7749, lon: -122.4194 },
  { id: "SEA", city: "Seattle", region: "North America", country: "US", lat: 47.6062, lon: -122.3321 },
  { id: "ORD", city: "Chicago", region: "North America", country: "US", lat: 41.8781, lon: -87.6298 },
  { id: "DFW", city: "Dallas", region: "North America", country: "US", lat: 32.7767, lon: -96.797 },
  { id: "MIA", city: "Miami", region: "North America", country: "US", lat: 25.7617, lon: -80.1918 },
  { id: "JFK", city: "New York", region: "North America", country: "US", lat: 40.7128, lon: -74.006 },
  { id: "IAD", city: "Washington DC", region: "North America", country: "US", lat: 38.9072, lon: -77.0369 },
  { id: "ATL", city: "Atlanta", region: "North America", country: "US", lat: 33.749, lon: -84.388 },
  { id: "YYZ", city: "Toronto", region: "North America", country: "CA", lat: 43.6532, lon: -79.3832 },
  { id: "YVR", city: "Vancouver", region: "North America", country: "CA", lat: 49.2827, lon: -123.1207 },
  { id: "MEX", city: "Mexico City", region: "North America", country: "MX", lat: 19.4326, lon: -99.1332 },

  // Europe
  { id: "LHR", city: "London", region: "Europe", country: "GB", lat: 51.5074, lon: -0.1278 },
  { id: "CDG", city: "Paris", region: "Europe", country: "FR", lat: 48.8566, lon: 2.3522 },
  { id: "FRA", city: "Frankfurt", region: "Europe", country: "DE", lat: 50.1109, lon: 8.6821 },
  { id: "AMS", city: "Amsterdam", region: "Europe", country: "NL", lat: 52.3676, lon: 4.9041 },
  { id: "MAD", city: "Madrid", region: "Europe", country: "ES", lat: 40.4168, lon: -3.7038 },
  { id: "MXP", city: "Milan", region: "Europe", country: "IT", lat: 45.4642, lon: 9.19 },
  { id: "WAW", city: "Warsaw", region: "Europe", country: "PL", lat: 52.2297, lon: 21.0122 },
  { id: "ARN", city: "Stockholm", region: "Europe", country: "SE", lat: 59.3293, lon: 18.0686 },
  { id: "HEL", city: "Helsinki", region: "Europe", country: "FI", lat: 60.1699, lon: 24.9384 },
  { id: "VIE", city: "Vienna", region: "Europe", country: "AT", lat: 48.2082, lon: 16.3738 },
  { id: "ZRH", city: "Zurich", region: "Europe", country: "CH", lat: 47.3769, lon: 8.5417 },
  { id: "BRU", city: "Brussels", region: "Europe", country: "BE", lat: 50.8503, lon: 4.3517 },
  { id: "OSL", city: "Oslo", region: "Europe", country: "NO", lat: 59.9139, lon: 10.7522 },
  { id: "CPH", city: "Copenhagen", region: "Europe", country: "DK", lat: 55.6761, lon: 12.5683 },
  { id: "MAN", city: "Manchester", region: "Europe", country: "GB", lat: 53.4808, lon: -2.2426 },

  // South America
  { id: "GRU", city: "Sao Paulo", region: "South America", country: "BR", lat: -23.5505, lon: -46.6333 },
  { id: "EZE", city: "Buenos Aires", region: "South America", country: "AR", lat: -34.6037, lon: -58.3816 },
  { id: "SCL", city: "Santiago", region: "South America", country: "CL", lat: -33.4489, lon: -70.6693 },
  { id: "BOG", city: "Bogota", region: "South America", country: "CO", lat: 4.711, lon: -74.0721 },
  { id: "LIM", city: "Lima", region: "South America", country: "PE", lat: -12.0464, lon: -77.0428 },

  // Middle East & Africa
  { id: "DXB", city: "Dubai", region: "Middle East & Africa", country: "AE", lat: 25.2048, lon: 55.2708 },
  { id: "JED", city: "Jeddah", region: "Middle East & Africa", country: "SA", lat: 21.4858, lon: 39.1925 },
  { id: "TLV", city: "Tel Aviv", region: "Middle East & Africa", country: "IL", lat: 32.0853, lon: 34.7818 },
  { id: "CAI", city: "Cairo", region: "Middle East & Africa", country: "EG", lat: 30.0444, lon: 31.2357 },
  { id: "NBO", city: "Nairobi", region: "Middle East & Africa", country: "KE", lat: -1.2921, lon: 36.8219 },
  { id: "JNB", city: "Johannesburg", region: "Middle East & Africa", country: "ZA", lat: -26.2041, lon: 28.0473 },
  { id: "LOS", city: "Lagos", region: "Middle East & Africa", country: "NG", lat: 6.5244, lon: 3.3792 },

  // Central Asia
  { id: "ALA", city: "Almaty", region: "Central Asia", country: "KZ", lat: 43.2389, lon: 76.9455 },
  { id: "TAS", city: "Tashkent", region: "Central Asia", country: "UZ", lat: 41.2995, lon: 69.2401 },

  // Eastern Europe
  { id: "OTP", city: "Bucharest", region: "Eastern Europe", country: "RO", lat: 44.4268, lon: 26.1025 },
  { id: "SOF", city: "Sofia", region: "Eastern Europe", country: "BG", lat: 42.6977, lon: 23.3219 },
  { id: "BEG", city: "Belgrade", region: "Eastern Europe", country: "RS", lat: 44.7866, lon: 20.4489 },
  { id: "ZAG", city: "Zagreb", region: "Eastern Europe", country: "HR", lat: 45.815, lon: 15.9819 },

  // Pacific Islands
  { id: "SUVA", city: "Suva", region: "Pacific Islands", country: "FJ", lat: -18.1416, lon: 178.4419 },
  { id: "PPT", city: "Papeete", region: "Pacific Islands", country: "PF", lat: -17.5516, lon: -149.5585 },

  // Additional Africa
  { id: "ACC", city: "Accra", region: "Africa", country: "GH", lat: 5.6037, lon: -0.187 },
  { id: "DAR", city: "Dar es Salaam", region: "Africa", country: "TZ", lat: -6.7924, lon: 39.2083 },

  // South Asia
  { id: "CMB", city: "Colombo", region: "South Asia", country: "LK", lat: 6.9271, lon: 79.8612 },
  { id: "KTM", city: "Kathmandu", region: "South Asia", country: "NP", lat: 27.7172, lon: 85.324 },

  // Oceania
  { id: "AKL", city: "Auckland", region: "Oceania", country: "NZ", lat: -36.8485, lon: 174.7633 },
];

/**
 * Haversine distance between two coordinates in kilometers.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface ServerSelectionResult {
  edge: EdgeLocation;
  distanceKm: number;
  estimatedLatencyMs: number;
  allEdges: Array<{
    id: string;
    city: string;
    country: string;
    distanceKm: number;
  }>;
}

/**
 * Select the nearest Cloudflare edge based on client geolocation.
 * Returns the closest edge plus distance estimates for the top 5.
 *
 * The estimated latency is a rough heuristic:
 * - ~1ms per 100km for nearby edges (fiber routing)
 * - ~2-3ms per 100km for transcontinental paths
 * - This is a LOWER BOUND — actual latency includes queuing, processing, etc.
 */
export function selectNearestEdge(
  clientLat: number,
  clientLon: number,
): ServerSelectionResult {
  // Calculate distance to all edges
  const edgesWithDistance = CF_EDGES.map((edge) => ({
    ...edge,
    distanceKm: haversineDistance(clientLat, clientLon, edge.lat, edge.lon),
  }));

  // Sort by distance
  edgesWithDistance.sort((a, b) => a.distanceKm - b.distanceKm);

  const nearest = edgesWithDistance[0];

  // Estimate latency: ~1ms per 100km for nearby, scaling up for distance
  // This is a conservative estimate — real latency depends on routing paths
  const estimatedLatencyMs = nearest.distanceKm < 500
    ? nearest.distanceKm * 0.01 // <500km: ~0.01ms/km (metro routing)
    : nearest.distanceKm < 2000
      ? 5 + (nearest.distanceKm - 500) * 0.005 // 500-2000km: 5ms base + 0.005ms/km
      : 12.5 + (nearest.distanceKm - 2000) * 0.01; // >2000km: 12.5ms base + 0.01ms/km

  return {
    edge: nearest,
    distanceKm: Math.round(nearest.distanceKm),
    estimatedLatencyMs: Math.round(estimatedLatencyMs * 10) / 10,
    allEdges: edgesWithDistance.slice(0, 5).map((e) => ({
      id: e.id,
      city: e.city,
      country: e.country,
      distanceKm: Math.round(e.distanceKm),
    })),
  };
}

/**
 * Get a human-readable description of the server selection.
 */
export function describeServerSelection(result: ServerSelectionResult): string {
  const { edge, distanceKm, estimatedLatencyMs } = result;
  return `Edge: ${edge.city}, ${edge.country} (${edge.id}) — ${distanceKm}km away, ~${estimatedLatencyMs}ms estimated RTT`;
}
