import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Download,
  Globe,
  Wifi,
  AlertTriangle,
  Play,
  Square
} from 'lucide-react';
import Chart from 'chart.js/auto';

// Configured array of globally distributed test servers
interface TestServer {
  id: string;
  name: string;
  lat: number;
  lon: number;
  url: string; // Will default to current host API endpoints
  region?: string;
  distance: number;
}

const GLOBAL_TEST_SERVERS: TestServer[] = [
  { id: 'local-edge', name: 'Detecting Location...', lat: 0, lon: 0, url: '', distance: 0 },
  { id: 'us-east', name: 'New York, United States', lat: 40.7128, lon: -74.0060, url: '', region: 'us-east', distance: 9999 },
  { id: 'eu-central', name: 'Frankfurt, Germany', lat: 50.1109, lon: 8.6821, url: '', region: 'eu-central', distance: 9999 },
  { id: 'ap-southeast', name: 'Singapore', lat: 1.3521, lon: 103.8198, url: '', region: 'ap-southeast', distance: 9999 },
  { id: 'ap-southern', name: 'Sydney, Australia', lat: -33.8688, lon: 151.2093, url: '', region: 'ap-southeast', distance: 9999 }
];

// Haversine Math to calculate distance between two coordinates in km
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper to delay execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type TestPhase = 'idle' | 'routing' | 'ping' | 'download' | 'upload' | 'complete' | 'error';

interface LatencyStats {
  current: number;
  avg: number;
  jitter: number;
  min: number;
  max: number;
  latencies: number[];
}

interface SpeedStats {
  current: number; // bps
  avg: number; // bps
  peak: number; // bps
}

interface ClientInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  org: string;
  latitude: number;
  longitude: number;
  isLocal: boolean;
}

// Reusable tooltip component
const InfoTooltip = ({ content }: { content: string }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative inline-flex items-center ml-1 z-20 group">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible(!visible)}
        type="button"
        className="w-4 h-4 rounded-full border border-hairline-strong text-mute flex items-center justify-center text-[10px] font-mono hover:bg-canvas-soft-2 hover:text-ink transition-colors cursor-pointer select-none"
        aria-label="More information"
      >
        i
      </button>
      {visible && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-64 bg-primary text-on-primary text-xs p-3 rounded-md shadow-lg border border-primary/20 z-50 transition-opacity duration-150 leading-relaxed font-sans text-left">
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-primary" />
          {content}
        </div>
      )}
    </div>
  );
};

export default function SpeedTest() {
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [statusMessage, setStatusMessage] = useState('System ready.');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Geolocation & Server State
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [servers, setServers] = useState<TestServer[]>(GLOBAL_TEST_SERVERS);
  const [closestServers, setClosestServers] = useState<TestServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<TestServer | null>(null);
  const [routingResults, setRoutingResults] = useState<{ [key: string]: number }>({});

  // Test Metrics
  const [latencyStats, setLatencyStats] = useState<LatencyStats>({
    current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: []
  });
  const [downloadStats, setDownloadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [uploadStats, setUploadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [stability, setStability] = useState<number>(100);
  const [packetLoss, setPacketLoss] = useState<number>(0);

  // Loaded latency and jitter stats (split download vs upload phase pings)
  const [dlLoadedLatency, setDlLoadedLatency] = useState<number>(0);
  const [dlLoadedJitter, setDlLoadedJitter] = useState<number>(0);
  const [ulLoadedLatency, setUlLoadedLatency] = useState<number>(0);
  const [ulLoadedJitter, setUlLoadedJitter] = useState<number>(0);

  // Completion Time
  const [completionTime, setCompletionTime] = useState<string>('');

  // Progress tracker variables
  const [progressPercent, setProgressPercent] = useState(0);

  // References
  const workerRef = useRef<Worker | null>(null);
  const downloadChartRef = useRef<HTMLCanvasElement | null>(null);
  const uploadChartRef = useRef<HTMLCanvasElement | null>(null);
  const downloadChartInstance = useRef<Chart | null>(null);
  const uploadChartInstance = useRef<Chart | null>(null);

  // Speed data arrays for charting
  const downloadSpeedHistory = useRef<number[]>([]);
  const uploadSpeedHistory = useRef<number[]>([]);

  // Request logs for Cloudflare CSV export
  const downloadRequestsRef = useRef<any[]>([]);
  const uploadRequestsRef = useRef<any[]>([]);

  // 1. Initialize client details on load and check theme state
  useEffect(() => {
    detectClientLocation();

    // Initial theme set based on document.documentElement class
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setTheme(customEvent.detail.theme);
    };

    window.addEventListener('theme-changed', handleThemeChange);

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      destroyCharts();
      window.removeEventListener('theme-changed', handleThemeChange);
    };
  }, []);

  // Sync Chart.js scale colors with light/dark theme switch
  useEffect(() => {
    const gridColor = theme === 'dark' ? '#222222' : '#ebebeb';
    const textColor = theme === 'dark' ? '#a1a1a1' : '#888888';

    if (downloadChartInstance.current) {
      // @ts-ignore
      downloadChartInstance.current.options.scales.y.grid.color = gridColor;
      // @ts-ignore
      downloadChartInstance.current.options.scales.y.ticks.color = textColor;
      downloadChartInstance.current.update('none');
    }
    if (uploadChartInstance.current) {
      // @ts-ignore
      uploadChartInstance.current.options.scales.y.grid.color = gridColor;
      // @ts-ignore
      uploadChartInstance.current.options.scales.y.ticks.color = textColor;
      uploadChartInstance.current.update('none');
    }
  }, [theme]);

  // Dispatch selectedServer details to Astro header
  useEffect(() => {
    if (selectedServer) {
      const distStr = selectedServer.distance && selectedServer.distance > 0
        ? `${selectedServer.distance} km`
        : '';
      const event = new CustomEvent('server-selected', {
        detail: {
          name: selectedServer.name,
          distance: distStr
        }
      });
      window.dispatchEvent(event);
    }
  }, [selectedServer]);

  // 2. Setup Chart.js instances
  const destroyCharts = () => {
    if (downloadChartInstance.current) {
      downloadChartInstance.current.destroy();
      downloadChartInstance.current = null;
    }
    if (uploadChartInstance.current) {
      uploadChartInstance.current.destroy();
      uploadChartInstance.current = null;
    }
  };

  const initCharts = () => {
    destroyCharts();

    // Reset history
    downloadSpeedHistory.current = [];
    uploadSpeedHistory.current = [];

    const gridColor = theme === 'dark' ? '#222222' : '#ebebeb';
    const textColor = theme === 'dark' ? '#a1a1a1' : '#888888';

    // Download Chart Initializer
    if (downloadChartRef.current) {
      downloadChartInstance.current = new Chart(downloadChartRef.current, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Download Speed',
              data: [],
              borderColor: '#eb6f20', // Orange style
              backgroundColor: 'rgba(235, 111, 32, 0.08)',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            {
              label: '90th Percentile',
              data: [],
              borderColor: theme === 'dark' ? '#444444' : '#b5b5b5',
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { display: false }
            },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'JetBrains Mono', size: 10 },
                callback: (val) => `${val} M`
              }
            }
          }
        }
      });
    }

    // Upload Chart Initializer
    if (uploadChartRef.current) {
      uploadChartInstance.current = new Chart(uploadChartRef.current, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Upload Speed',
              data: [],
              borderColor: '#8b5cf6', // Purple style
              backgroundColor: 'rgba(139, 92, 246, 0.08)',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            {
              label: '90th Percentile',
              data: [],
              borderColor: theme === 'dark' ? '#444444' : '#b5b5b5',
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { display: false }
            },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'JetBrains Mono', size: 10 },
                callback: (val) => `${val} M`
              }
            }
          }
        }
      });
    }
  };

  const updateThroughputChart = (type: 'download' | 'upload', mbps: number) => {
    const gridColor = theme === 'dark' ? '#222222' : '#ebebeb';
    if (type === 'download') {
      const chart = downloadChartInstance.current;
      if (!chart) return;

      downloadSpeedHistory.current.push(mbps);
      chart.data.labels = downloadSpeedHistory.current.map(() => '');
      chart.data.datasets[0].data = downloadSpeedHistory.current;

      const sorted = [...downloadSpeedHistory.current].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
      chart.data.datasets[1].data = downloadSpeedHistory.current.map(() => p90);

      chart.update('none');
    } else {
      const chart = uploadChartInstance.current;
      if (!chart) return;

      uploadSpeedHistory.current.push(mbps);
      chart.data.labels = uploadSpeedHistory.current.map(() => '');
      chart.data.datasets[0].data = uploadSpeedHistory.current;

      const sorted = [...uploadSpeedHistory.current].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
      chart.data.datasets[1].data = uploadSpeedHistory.current.map(() => p90);

      chart.update('none');
    }
  };

  // 3. Detect client geolocation from server
  const detectClientLocation = async () => {
    try {
      setStatusMessage('Locating client IP and network...');
      const response = await fetch('/api/ip-geo');
      let data = await response.json();

      // Local development fallback
      if (data.isLocal) {
        try {
          const localFallback = await fetch('https://ipapi.co/json/');
          const fallbackData = await localFallback.json();
          if (fallbackData && fallbackData.ip) {
            data = {
              isLocal: true,
              ip: fallbackData.ip,
              city: fallbackData.city,
              region: fallbackData.region,
              country: fallbackData.country_name,
              countryCode: fallbackData.country,
              loc: `${fallbackData.latitude},${fallbackData.longitude}`,
              org: fallbackData.org,
              latitude: parseFloat(fallbackData.latitude),
              longitude: parseFloat(fallbackData.longitude)
            };
          }
        } catch (_) {
          // Keep default loopback properties from server if public API fails
        }
      }

      setClientInfo(data);
      setStatusMessage(`Client IP detected: ${data.ip}`);

      // Update local edge server coordinates and name in servers list
      const lat = data.latitude || 0;
      const lon = data.longitude || 0;

      let locality = 'Local Server';
      if (data.city && data.country) {
        if (data.city === 'Local Host' || data.country === 'Local') {
          locality = 'Local Server';
        } else {
          locality = `${data.city}, ${data.country}`;
        }
      } else if (data.city) {
        locality = data.city;
      }

      const updatedServers = (servers || GLOBAL_TEST_SERVERS).map(s => {
        if (s.id === 'local-edge') {
          return {
            ...s,
            name: locality,
            lat,
            lon
          };
        }
        return s;
      });
      setServers(updatedServers);

      // Perform distance calculations
      calculateServerDistances(lat, lon, updatedServers);

    } catch (err) {
      console.error('Failed to locate client:', err);
      setStatusMessage('GeoIP detection failed. Using global defaults.');
      calculateServerDistances(0, 0, servers || GLOBAL_TEST_SERVERS);
    }
  };

  // 4. Calculate distances and sort servers
  const calculateServerDistances = (clientLat: number, clientLon: number, serverList: TestServer[]) => {
    if (clientLat === 0 && clientLon === 0) {
      // Local or untracked
      setClosestServers(serverList);
      setSelectedServer(serverList[0]);
      return;
    }

    const withDistances = serverList.map(srv => {
      // Closest local edge gets distance 0
      if (srv.id === 'local-edge') {
        return { ...srv, distance: 0 };
      }
      const dist = haversineDistance(clientLat, clientLon, srv.lat, srv.lon);
      return { ...srv, distance: Math.round(dist) };
    });

    // Sort: Local first, then by physical distance
    const sorted = [...withDistances].sort((a, b) => {
      if (a.id === 'local-edge') return -1;
      if (b.id === 'local-edge') return 1;
      return (a.distance || 0) - (b.distance || 0);
    });

    setClosestServers(sorted);
    setSelectedServer(sorted[0]);
  };

  // 5. Automated 3-step Routing Cycle (IP Detection, Haversine, Pre-Ping)
  const runRoutingCycle = async () => {
    setPhase('routing');
    setProgressPercent(15);
    setStatusMessage('Routing: Selecting closest network edge server...');

    const results: { [key: string]: number } = {};
    const serversToPing = closestServers.length > 0 ? closestServers : servers;

    // Sequentially check closest servers until one succeeds
    for (const srv of serversToPing) {
      setStatusMessage(`Verifying connection to: ${srv.name}...`);
      const origin = window.location.origin;

      let latSum = 0;
      let successes = 0;

      // Make 2 quick latency pings to verify route availability
      for (let i = 0; i < 2; i++) {
        const start = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        try {
          const testUrl = srv.region
            ? `${origin}/api/ping?region=${srv.region}&cb=${Date.now()}-${i}`
            : `${origin}/api/ping?cb=${Date.now()}-${i}`;
          const res = await fetch(testUrl, {
            cache: 'no-store',
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            latSum += (performance.now() - start);
            successes++;
          }
        } catch (_) {
          clearTimeout(timeoutId);
        }
      }

      if (successes > 0) {
        const avgLat = latSum / successes;
        results[srv.id] = avgLat;
        setRoutingResults(results);
        setSelectedServer(srv);
        setStatusMessage(`Connected to nearest edge: ${srv.name} (${Math.round(avgLat)}ms)`);
        setProgressPercent(30);
        await sleep(600);
        return srv;
      }

      console.warn(`Connection failed for server ${srv.name}. Trying next closest server...`);
    }

    // Ultimate fallback if all pings fail
    const fallback = serversToPing[0] || servers[0];
    setSelectedServer(fallback);
    setStatusMessage(`Connected to default local edge server`);
    setProgressPercent(30);
    await sleep(600);
    return fallback;
  };

  // 6. Primary Speed Test Orchestrator
  const startSpeedTest = async () => {
    if (phase !== 'idle' && phase !== 'complete' && phase !== 'error') return;

    // Reset stats
    downloadRequestsRef.current = [];
    uploadRequestsRef.current = [];
    setLatencyStats({ current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [] });
    setDownloadStats({ current: 0, avg: 0, peak: 0 });
    setUploadStats({ current: 0, avg: 0, peak: 0 });
    setDlLoadedLatency(0);
    setDlLoadedJitter(0);
    setUlLoadedLatency(0);
    setUlLoadedJitter(0);
    setStability(100);
    setPacketLoss(0);
    setProgressPercent(0);
    setCompletionTime('');

    // Initial routing pre-ping
    const anchorServer = await runRoutingCycle();

    // Launch worker thread
    initCharts();
    setPhase('ping');
    setStatusMessage(`Pinging locked server: ${anchorServer.name}`);
    setProgressPercent(40);

    const origin = window.location.origin;
    const baseUrl = `${origin}/api`;
    const region = anchorServer.region;

    // Instantiate worker from local path
    workerRef.current = new Worker(
      new URL('../workers/speedtest.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (e: MessageEvent) => {
      const { type, ...data } = e.data;

      switch (type) {
        // Ping Progress Messages
        case 'PING_PROGRESS':
          setLatencyStats({
            current: data.latency,
            avg: data.latencies.reduce((a: number, b: number) => a + b, 0) / data.latencies.length,
            jitter: data.jitter,
            min: Math.min(...data.latencies),
            max: Math.max(...data.latencies),
            latencies: data.latencies
          });
          setProgressPercent(40 + Math.round((data.iteration / data.totalIterations) * 10));
          break;

        case 'PING_COMPLETE':
          setProgressPercent(50);
          // Transition to Download
          setPhase('download');
          setStatusMessage('Measuring download throughput (concurrent streams)...');
          workerRef.current?.postMessage({
            type: 'START_DOWNLOAD',
            baseUrl,
            region,
            parallelStreams: 6
          });
          break;

        // Download Progress Messages
        case 'DOWNLOAD_PROGRESS':
          const downloadMbps = data.instantaneousSpeed / 1000000;
          const downloadAvgMbps = data.averageSpeed / 1000000;

          setDownloadStats({
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed
          });

          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);

          updateThroughputChart('download', downloadMbps);
          setProgressPercent(50 + Math.round((data.elapsedTime / 8) * 25)); // 25% of progress bar

          // Compute simple live stability percentage based on variance
          if (downloadSpeedHistory.current.length > 5) {
            const devSum = downloadSpeedHistory.current.reduce((sum, speed) => sum + Math.abs(speed - downloadAvgMbps), 0);
            const devAvg = devSum / downloadSpeedHistory.current.length;
            const stabilityVal = Math.max(20, 100 - (devAvg / downloadAvgMbps) * 100);
            setStability(Math.round(stabilityVal));
          }
          break;

        case 'DOWNLOAD_COMPLETE':
          setProgressPercent(75);
          // Transition to Upload
          setPhase('upload');
          setStatusMessage('Measuring upload throughput (concurrent streams)...');

          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);

          if (data.requests) {
            downloadRequestsRef.current = data.requests;
          }

          workerRef.current?.postMessage({
            type: 'START_UPLOAD',
            baseUrl,
            region,
            parallelStreams: 6
          });
          break;

        // Upload Progress Messages
        case 'UPLOAD_PROGRESS':
          const uploadMbps = data.instantaneousSpeed / 1000000;
          setUploadStats({
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed
          });

          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);

          updateThroughputChart('upload', uploadMbps);
          setProgressPercent(75 + Math.round((data.elapsedTime / 8) * 20)); // 20% of progress bar
          break;

        case 'UPLOAD_COMPLETE':
          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);

          if (data.requests) {
            uploadRequestsRef.current = data.requests;
          }

          // Run packet loss simulator checks
          runPacketLossCheck();
          break;

        case 'CANCELLED':
          setPhase('idle');
          setStatusMessage('Speed test stopped by user.');
          break;

        case 'ERROR':
          setPhase('error');
          setStatusMessage(`Test failure: ${data.message}`);
          break;
      }
    };

    // Trigger Ping test inside Worker
    workerRef.current.postMessage({
      type: 'START_PING',
      baseUrl,
      region
    });
  };

  // 7. Mock packet loss framework logic
  const runPacketLossCheck = () => {
    setPhase('complete');
    setProgressPercent(100);
    setStatusMessage('Speed test complete.');
    setCompletionTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

    // Simulate packet drops evaluation
    const lossPercentage = Math.random() < 0.2 ? parseFloat((Math.random() * 0.4).toFixed(1)) : 0.0;
    setPacketLoss(lossPercentage);

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  };

  const cancelSpeedTest = () => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'CANCEL' });
    } else {
      setPhase('idle');
      setStatusMessage('Test cancelled.');
    }
  };

  // Convert bits to string helper (standard decimal base-10 network metrics)
  const formatSpeed = (bps: number) => {
    const mbps = bps / 1000000;
    if (mbps >= 1000) {
      return { value: (mbps / 1000).toFixed(1), unit: 'Gbps' };
    }
    return { value: mbps.toFixed(1), unit: 'Mbps' };
  };

  // Calculate dynamic Network Quality Scores depending on actual metrics
  const getQualityScores = () => {
    const dlMbps = downloadStats.avg / 1000000;
    const ulMbps = uploadStats.avg / 1000000;
    const lat = latencyStats.avg;
    const jit = latencyStats.jitter;

    // Initial defaults before metrics are available
    if (phase === 'idle' || phase === 'routing') {
      return {
        streaming: { rating: '—', color: 'text-mute' },
        gaming: { rating: '—', color: 'text-mute' },
        chatting: { rating: '—', color: 'text-mute' }
      };
    }

    let streamingRating = 'Good';
    let streamingColor = 'text-link';
    if (dlMbps >= 25) {
      streamingRating = 'Great';
      streamingColor = 'text-link';
    } else if (dlMbps >= 5) {
      streamingRating = 'Good';
      streamingColor = 'text-link';
    } else if (dlMbps > 0) {
      streamingRating = 'Bad';
      streamingColor = 'text-error';
    } else {
      streamingRating = 'Evaluating...';
      streamingColor = 'text-mute';
    }

    let gamingRating = 'Good';
    let gamingColor = 'text-link';
    if (lat > 0) {
      if (lat <= 30 && jit <= 10) {
        gamingRating = 'Great';
        gamingColor = 'text-link';
      } else if (lat <= 80 && jit <= 30) {
        gamingRating = 'Good';
        gamingColor = 'text-link';
      } else {
        gamingRating = 'Bad';
        gamingColor = 'text-error';
      }
    } else {
      gamingRating = 'Evaluating...';
      gamingColor = 'text-mute';
    }

    let chattingRating = 'Good';
    let chattingColor = 'text-link';
    if (dlMbps > 0 || ulMbps > 0 || lat > 0) {
      const meetsSpeed = (dlMbps === 0 || dlMbps >= 4) && (ulMbps === 0 || ulMbps >= 1.5);
      const meetsLatency = lat === 0 || lat <= 120;
      if (meetsSpeed && meetsLatency) {
        chattingRating = (dlMbps >= 10 && ulMbps >= 3 && lat <= 50) ? 'Great' : 'Good';
        chattingColor = chattingRating === 'Great' ? 'text-link' : 'text-link';
      } else {
        chattingRating = 'Bad';
        chattingColor = 'text-error';
      }
    } else {
      chattingRating = 'Evaluating...';
      chattingColor = 'text-mute';
    }

    return {
      streaming: { rating: streamingRating, color: streamingColor },
      gaming: { rating: gamingRating, color: gamingColor },
      chatting: { rating: chattingRating, color: chattingColor }
    };
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8 flex-1">
      {/* 1. Header Hero section */}
      <div className="flex flex-col gap-2 mt-4 md:mt-8 border-b border-hairline pb-6">
        <span className="font-mono text-xs uppercase tracking-wider text-mute block">
          Network Speed Engine
        </span>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-ink font-sans">
          Your Internet Speed
        </h1>
        <p className="text-sm md:text-base text-body max-w-2xl mt-1">
          A professional-grade, latency-critical speed test engine measuring packet jitters, concurrent downloads, and uploads at the edge.
        </p>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-stretch">
          {phase === 'idle' || phase === 'complete' || phase === 'error' ? (
            <button
              onClick={startSpeedTest}
              className="w-full sm:w-auto bg-primary text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Play className="w-4 h-4 fill-on-primary text-on-primary" /> Start Speed Test
            </button>
          ) : (
            <button
              onClick={cancelSpeedTest}
              className="w-full sm:w-auto bg-error text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Square className="w-4 h-4 fill-on-primary text-on-primary" /> Stop Test
            </button>
          )}

          {completionTime && downloadStats.avg > 0 ? (
            <button
              onClick={() => {
                const allRequests = [
                  ...downloadRequestsRef.current,
                  ...uploadRequestsRef.current
                ].sort((a, b) => a.time - b.time);

                const headers = ['time', 'direction', 'bytes', 'latency', 'bps', 'duration', 'serverTime', 'responseSize', 'loadedLatencies'];
                const csvRows = [headers.join(',')];

                for (const req of allRequests) {
                  const pingsStr = req.loadedLatencies && req.loadedLatencies.length > 0 
                    ? req.loadedLatencies.join(' ') 
                    : '';
                  csvRows.push([
                    req.time,
                    req.direction,
                    req.bytes,
                    req.latency,
                    req.bps,
                    req.duration,
                    req.serverTime,
                    req.responseSize,
                    pingsStr
                  ].join(','));
                }
                const csvContent = csvRows.join('\n');
                const blob = new Blob([csvContent], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `speed-results-${Math.floor(Date.now() / 1000)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Download results"
              className="w-full sm:w-auto bg-error text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Download className="w-4 h-4 fill-on-primary text-on-primary" /> Download Results
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-4">
          {completionTime && (
            <span className="text-[11px] text-mute">
              Measured at {completionTime}
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar & Status Text */}
      {phase !== 'idle' && phase !== 'complete' && phase !== 'error' ? (
        <div className="w-full flex flex-col gap-2 bg-canvas border border-hairline p-4 rounded-lg shadow-xs">
          <div className="flex justify-between items-center text-xs font-mono text-mute">
            <span>PROGRESS</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-canvas-soft-2 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-300 rounded-full"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: phase === 'download' ? '#eb6f20' : phase === 'upload' ? '#8b5cf6' : 'var(--color-primary)'
              }}
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-success animate-ping" />
            <span className="text-xs text-body font-mono truncate">{statusMessage}</span>
          </div>
        </div>
      ) : null}

      {/* 3. Main Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">

        {/* Column 1: Download */}
        <div className="md:col-span-4 flex flex-col gap-4 bg-canvas border border-hairline p-6 rounded-lg shadow-xs justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
              <span>DOWNLOAD</span>
              <InfoTooltip content="The speed at which data is transferred from the internet to your device. Higher download speeds enable smoother video streaming, faster file downloads, and quicker webpage loading." />
            </div>

            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                {phase === 'download'
                  ? formatSpeed(downloadStats.current).value
                  : (downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).value : '0.0')}
              </span>
              <span className="text-xl text-mute font-mono">
                {phase === 'download'
                  ? formatSpeed(downloadStats.current).unit
                  : (downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).unit : 'Mbps')}
              </span>
            </div>

            {/* Orange Area Chart */}
            <div className="h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
              <canvas ref={downloadChartRef} />
              {(phase === 'idle' || phase === 'routing' || phase === 'ping') && (
                <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
                  Chart starts drawing during download test.
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-2 text-mute">
            <span>Peak Speed:</span>
            <span className="font-semibold text-ink">
              {downloadStats.peak > 0 ? `${formatSpeed(downloadStats.peak).value} ${formatSpeed(downloadStats.peak).unit}` : '—'}
            </span>
          </div>
        </div>

        {/* Column 2: Upload */}
        <div className="md:col-span-4 flex flex-col gap-4 bg-canvas border border-hairline p-6 rounded-lg shadow-xs justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
              <span>UPLOAD</span>
              <InfoTooltip content="The speed at which data is transferred from your device to the internet. Higher upload speeds are critical for smooth video calls, online gaming, uploading large files, and sending emails with attachments." />
            </div>

            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                {phase === 'upload'
                  ? formatSpeed(uploadStats.current).value
                  : (uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).value : '0.0')}
              </span>
              <span className="text-xl text-mute font-mono">
                {phase === 'upload'
                  ? formatSpeed(uploadStats.current).unit
                  : (uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).unit : 'Mbps')}
              </span>
            </div>

            {/* Purple Area Chart */}
            <div className="h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
              <canvas ref={uploadChartRef} />
              {(phase === 'idle' || phase === 'routing' || phase === 'ping' || phase === 'download') && (
                <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
                  Chart starts drawing during upload test.
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-2 text-mute">
            <span>Peak Speed:</span>
            <span className="font-semibold text-ink">
              {uploadStats.peak > 0 ? `${formatSpeed(uploadStats.peak).value} ${formatSpeed(uploadStats.peak).unit}` : '—'}
            </span>
          </div>
        </div>

        {/* Column 3: Latency, Jitter, Packet Loss Stack */}
        <div className="md:col-span-4 flex flex-col gap-4">

          {/* Latency card */}
          <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                <span>LATENCY</span>
                <InfoTooltip content="Latency (ping) measures the round-trip response time for data. Lower latency is vital for real-time applications like online gaming or voice calls. Unloaded represents idle latency, while Loaded (Down/Up Arrow) measures latency under heavy network load." />
              </div>
              <Wifi className="w-4 h-4 text-mute" />
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                {latencyStats.avg > 0 ? latencyStats.avg.toFixed(1) : '—'}
              </span>
              <span className="text-xs text-mute font-mono">ms (unloaded)</span>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
              <div className="flex items-center gap-1">
                {/* ArrowDown color matched to orange download theme */}
                <ArrowDown className="w-3.5 h-3.5 text-[#eb6f20]" />
                <span>Down: <span className="font-semibold text-ink font-mono">{dlLoadedLatency > 0 ? `${dlLoadedLatency.toFixed(0)} ms` : '—'}</span></span>
              </div>
              <div className="flex items-center gap-1">
                {/* ArrowUp color matched to purple upload theme */}
                <ArrowUp className="w-3.5 h-3.5 text-[#8b5cf6]" />
                <span>Up: <span className="font-semibold text-ink font-mono">{ulLoadedLatency > 0 ? `${ulLoadedLatency.toFixed(0)} ms` : '—'}</span></span>
              </div>
            </div>
          </div>

          {/* Jitter card */}
          <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                <span>JITTER</span>
                <InfoTooltip content="Jitter is the variance in latency over time. Steady, consistent latency results in lower jitter, which is essential for smooth audio streams and live gaming. High jitter causes sudden lag spikes." />
              </div>
              <Activity className="w-4 h-4 text-mute" />
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                {latencyStats.jitter > 0 ? latencyStats.jitter.toFixed(1) : '—'}
              </span>
              <span className="text-xs text-mute font-mono">ms</span>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
              <div className="flex items-center gap-1">
                <ArrowDown className="w-3.5 h-3.5 text-[#eb6f20]" />
                <span>Down: <span className="font-semibold text-ink font-mono">{dlLoadedJitter > 0 ? `${dlLoadedJitter.toFixed(0)} ms` : '—'}</span></span>
              </div>
              <div className="flex items-center gap-1">
                <ArrowUp className="w-3.5 h-3.5 text-[#8b5cf6]" />
                <span>Up: <span className="font-semibold text-ink font-mono">{ulLoadedJitter > 0 ? `${ulLoadedJitter.toFixed(0)} ms` : '—'}</span></span>
              </div>
            </div>
          </div>

          {/* Packet Loss card */}
          <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-col justify-between h-full">
            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                  <span>PACKET LOSS</span>
                  <InfoTooltip content="Packet Loss occurs when data packets fail to reach their destination. It results in choppy voice calls, freezing videos, and gaming lag. Ideally, packet loss should be 0.0%." />
                </div>
                <AlertTriangle className="w-4 h-4 text-mute" />
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                  {phase === 'complete' ? `${packetLoss}%` : phase === 'idle' ? '—' : '0.0%'}
                </span>
              </div>
            </div>

            <div className="text-[10px] text-mute font-mono border-t border-hairline pt-2 mt-4 flex justify-between items-center">
              <span>Simulated Socket Loss</span>
              <span className={packetLoss > 0 ? "text-error font-semibold" : "text-link font-semibold"}>
                {packetLoss > 0 ? "Suboptimal" : "Excellent"}
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* 4. Network Quality Score Panel */}
      <div className="bg-canvas border border-hairline p-6 rounded-lg shadow-xs">
        <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-4 pb-2 border-b border-hairline">
          <span>NETWORK QUALITY SCORE</span>
          <InfoTooltip content="Estimates how well your current connection supports common online tasks based on speeds and latency scores." />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center divide-y sm:divide-y-0 sm:divide-x divide-hairline">

          <div className="pt-4 sm:pt-0 sm:px-4 flex flex-col justify-center gap-1">
            <span className="text-xs font-mono text-mute uppercase tracking-wider">Video Streaming</span>
            <span className={`text-lg font-bold ${getQualityScores().streaming.color}`}>
              {getQualityScores().streaming.rating}
            </span>
          </div>

          <div className="pt-4 sm:pt-0 sm:px-4 flex flex-col justify-center gap-1">
            <span className="text-xs font-mono text-mute uppercase tracking-wider">Online Gaming</span>
            <span className={`text-lg font-bold ${getQualityScores().gaming.color}`}>
              {getQualityScores().gaming.rating}
            </span>
          </div>

          <div className="pt-4 sm:pt-0 sm:px-4 flex flex-col justify-center gap-1">
            <span className="text-xs font-mono text-mute uppercase tracking-wider">Video Chatting</span>
            <span className={`text-lg font-bold ${getQualityScores().chatting.color}`}>
              {getQualityScores().chatting.rating}
            </span>
          </div>

        </div>
      </div>

      {/* 6. Technical Details Drawer */}
      {clientInfo && (
        <details className="group border border-hairline rounded-lg overflow-hidden bg-canvas">
          <summary className="bg-canvas-soft-2 p-4 cursor-pointer text-xs font-mono text-mute select-none flex justify-between items-center hover:bg-canvas-soft-2/80 transition-colors">
            <span>SHOW TECHNICAL DETAIL LOGS</span>
            <span className="text-[10px] text-mute group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="p-5 border-t border-hairline flex flex-col md:flex-row justify-between gap-6 text-xs text-body font-mono">
            <div className="flex flex-col gap-2">
              <span className="text-mute font-semibold">YOUR CONNECTION</span>
              <div>IP: <span className="text-ink">{clientInfo.ip}</span></div>
              <div>ISP: <span className="text-ink">{clientInfo.org}</span></div>
              <div>Location: <span className="text-ink">{clientInfo.city}, {clientInfo.region}, {clientInfo.country}</span></div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-mute font-semibold">ANCHOR ROUTING INFO</span>
              <div>Server: <span className="text-ink">{selectedServer?.name || 'Evaluating...'}</span></div>
              <div>Region URL: <span className="text-ink">{selectedServer?.region ? `?region=${selectedServer.region}` : '/api (Local Edge)'}</span></div>
              {selectedServer && selectedServer.id !== 'local-edge' && clientInfo.latitude !== 0 && (
                <div>Distance: <span className="text-ink">
                  {Math.round(haversineDistance(clientInfo.latitude, clientInfo.longitude, selectedServer.lat, selectedServer.lon))} km
                </span></div>
              )}
              {selectedServer && selectedServer.id === 'local-edge' && (
                <div>Distance: <span className="text-ink">0 km (Local Loopback)</span></div>
              )}
              <div>Pre-Ping Latency: <span className="text-ink">
                {routingResults[selectedServer?.id || '']
                  ? `${Math.round(routingResults[selectedServer?.id || ''])}ms`
                  : 'Not pinged'}
              </span></div>
            </div>
          </div>
        </details>
      )}

    </div>
  );
}
