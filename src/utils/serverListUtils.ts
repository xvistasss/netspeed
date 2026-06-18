import type { TestServer } from "./speedTestUtils";
import { haversineDistance } from "./speedTestUtils";

export type ServerList = Array<Omit<TestServer, "distance">>;

// Measurement nodes: geographic locations for latency estimation.
// All API calls route to the same origin — latency is simulated via estimateRtt().
export const SERVER_LIST: ServerList = [
  // Asia Pacific
  {
    id: "india-mumbai",
    name: "Mumbai, India",
    lat: 19.076,
    lon: 72.8777,
    region: "ap-south",
  },
  {
    id: "india-bangalore",
    name: "Bangalore, India",
    lat: 12.9716,
    lon: 77.5946,
    region: "ap-south",
  },
  {
    id: "singapore",
    name: "Singapore",
    lat: 1.3521,
    lon: 103.8198,
    region: "ap-southeast",
  },
  {
    id: "tokyo",
    name: "Tokyo, Japan",
    lat: 35.6762,
    lon: 139.6503,
    region: "ap-northeast",
  },
  {
    id: "seoul",
    name: "Seoul, South Korea",
    lat: 37.5665,
    lon: 126.978,
    region: "ap-northeast",
  },
  {
    id: "sydney",
    name: "Sydney, Australia",
    lat: -33.8688,
    lon: 151.2093,
    region: "ap-southeast",
  },
  // Europe
  {
    id: "frankfurt",
    name: "Frankfurt, Germany",
    lat: 50.1109,
    lon: 8.6821,
    region: "eu-central",
  },
  {
    id: "london",
    name: "London, United Kingdom",
    lat: 51.5072,
    lon: -0.1276,
    region: "eu-west",
  },
  {
    id: "paris",
    name: "Paris, France",
    lat: 48.8566,
    lon: 2.3522,
    region: "eu-west",
  },
  // Americas
  {
    id: "new-york",
    name: "New York, United States",
    lat: 40.7128,
    lon: -74.006,
    region: "us-east",
  },
  {
    id: "los-angeles",
    name: "Los Angeles, United States",
    lat: 34.0522,
    lon: -118.2437,
    region: "us-west",
  },
  {
    id: "toronto",
    name: "Toronto, Canada",
    lat: 43.6532,
    lon: -79.3832,
    region: "ca-central",
  },
  {
    id: "sao-paulo",
    name: "São Paulo, Brazil",
    lat: -23.5505,
    lon: -46.6333,
    region: "sa-east",
  },
  // Middle East & Africa
  {
    id: "johannesburg",
    name: "Johannesburg, South Africa",
    lat: -26.2041,
    lon: 28.0473,
    region: "af-south",
  },
  {
    id: "dubai",
    name: "Dubai, United Arab Emirates",
    lat: 25.2048,
    lon: 55.2708,
    region: "me-central",
  },
];

/**
 * Compute haversine distance (km) on the fly.
 */
export function withDistances(
  clientLat: number,
  clientLon: number,
  servers: ServerList,
): TestServer[] {
  const hasValidClientCoords =
    Number.isFinite(clientLat) &&
    Number.isFinite(clientLon) &&
    !(clientLat === 0 && clientLon === 0);

  return servers.map((srv) => {
    if (!hasValidClientCoords) {
      return { ...srv, distance: 9999 } as TestServer;
    }

    const dist = haversineDistance(clientLat, clientLon, srv.lat, srv.lon);
    return { ...srv, distance: Math.round(dist) } as TestServer;
  });
}

export function pickClosestN(servers: TestServer[], n: number): TestServer[] {
  return [...servers].sort((a, b) => a.distance - b.distance).slice(0, n);
}
