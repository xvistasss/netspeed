import type { TestServer } from './speedTestUtils';
import { haversineDistance } from './speedTestUtils';

export type ServerList = Array<Omit<TestServer, 'distance'>>;

export const SERVER_LIST: ServerList = [
    {
        id: 'india-tezpur',
        name: 'Tezpur, India',
        lat: 26.6528,
        lon: 92.7926,
        url: 'http://speedtest.frontlineinternetservices.com:8080/speedtest/upload.php',
        region: 'ap-south'
    },
    {
        id: 'india-agartala',
        name: 'Agartala, India',
        lat: 23.8315,
        lon: 91.2868,
        url: 'http://st.unistarbroadband.com:8080/speedtest/upload.php',
        region: 'ap-south'
    },
    {
        id: 'singapore',
        name: 'Singapore',
        lat: 1.3521,
        lon: 103.8198,
        url: '',
        region: 'ap-southeast'
    },
    {
        id: 'tokyo',
        name: 'Tokyo, Japan',
        lat: 35.6762,
        lon: 139.6503,
        url: '',
        region: 'ap-northeast'
    },
    {
        id: 'sydney',
        name: 'Sydney, Australia',
        lat: -33.8688,
        lon: 151.2093,
        url: '',
        region: 'ap-southeast'
    },
    {
        id: 'frankfurt',
        name: 'Frankfurt, Germany',
        lat: 50.1109,
        lon: 8.6821,
        url: '',
        region: 'eu-central'
    },
    {
        id: 'london',
        name: 'London, United Kingdom',
        lat: 51.5072,
        lon: -0.1276,
        url: '',
        region: 'eu-west'
    },
    {
        id: 'paris',
        name: 'Paris, France',
        lat: 48.8566,
        lon: 2.3522,
        url: '',
        region: 'eu-west'
    },
    {
        id: 'new-york',
        name: 'New York, United States',
        lat: 40.7128,
        lon: -74.0060,
        url: '',
        region: 'us-east'
    },
    {
        id: 'chicago',
        name: 'Chicago, United States',
        lat: 41.8781,
        lon: -87.6298,
        url: '',
        region: 'us-central'
    },
    {
        id: 'los-angeles',
        name: 'Los Angeles, United States',
        lat: 34.0522,
        lon: -118.2437,
        url: '',
        region: 'us-west'
    },
    {
        id: 'toronto',
        name: 'Toronto, Canada',
        lat: 43.6532,
        lon: -79.3832,
        url: '',
        region: 'ca-central'
    },
    {
        id: 'sao-paulo',
        name: 'São Paulo, Brazil',
        lat: -23.5505,
        lon: -46.6333,
        url: '',
        region: 'sa-east'
    },
    {
        id: 'johannesburg',
        name: 'Johannesburg, South Africa',
        lat: -26.2041,
        lon: 28.0473,
        url: '',
        region: 'af-south'
    }
];

/**
 * Compute haversine distance (km) on the fly.
 * - local-edge is treated as distance=0
 * - other servers get rounded haversine distance
 */
export function withDistances(clientLat: number, clientLon: number, servers: ServerList): TestServer[] {
    const hasValidClientCoords = 
        Number.isFinite(clientLat) && 
        Number.isFinite(clientLon) && 
        !(clientLat === 0 && clientLon === 0);

    return servers.map((srv) => {
        if (srv.id === 'local-edge') {
            return { ...srv, distance: 0 } as TestServer;
        }

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
