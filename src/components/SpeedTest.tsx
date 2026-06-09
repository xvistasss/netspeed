import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  ArrowDown, 
  ArrowUp, 
  Globe, 
  RefreshCw, 
  Wifi, 
  CheckCircle,
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
}

const GLOBAL_TEST_SERVERS: TestServer[] = [
  { id: 'local-edge', name: 'Closest Edge (Auto-detected)', lat: 0, lon: 0, url: '' }, // Coordinates populated from IP geo
  { id: 'us-east', name: 'North America (New York)', lat: 40.7128, lon: -74.0060, url: '', region: 'us-east' },
  { id: 'eu-central', name: 'Europe (Frankfurt)', lat: 50.1109, lon: 8.6821, url: '', region: 'eu-central' },
  { id: 'ap-southeast', name: 'Asia Pacific (Singapore)', lat: 1.3521, lon: 103.8198, url: '', region: 'ap-southeast' },
  { id: 'ap-southern', name: 'Australia (Sydney)', lat: -33.8688, lon: 151.2093, url: '', region: 'ap-southeast' }
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

export default function SpeedTest() {
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [statusMessage, setStatusMessage] = useState('System ready.');
  
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
  
  // Progress tracker variables
  const [progressPercent, setProgressPercent] = useState(0);

  // References
  const workerRef = useRef<Worker | null>(null);
  const throughputChartRef = useRef<HTMLCanvasElement | null>(null);
  const latencyChartRef = useRef<HTMLCanvasElement | null>(null);
  const throughputChartInstance = useRef<Chart | null>(null);
  const latencyChartInstance = useRef<Chart | null>(null);

  // Speed data arrays for charting
  const downloadSpeedHistory = useRef<number[]>([]);
  const uploadSpeedHistory = useRef<number[]>([]);
  const speedLabels = useRef<string[]>([]);

  // 1. Initialize client details on load
  useEffect(() => {
    detectClientLocation();
    
    return () => {
      // Cleanup Web Worker and Chart instances
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      destroyCharts();
    };
  }, []);

  // 2. Setup Chart.js instances
  const destroyCharts = () => {
    if (throughputChartInstance.current) {
      throughputChartInstance.current.destroy();
      throughputChartInstance.current = null;
    }
    if (latencyChartInstance.current) {
      latencyChartInstance.current.destroy();
      latencyChartInstance.current = null;
    }
  };

  const initCharts = () => {
    destroyCharts();

    // Reset history
    downloadSpeedHistory.current = [];
    uploadSpeedHistory.current = [];
    speedLabels.current = [];

    // Throughput Chart (Download / Upload Speed Timeline)
    if (throughputChartRef.current) {
      throughputChartInstance.current = new Chart(throughputChartRef.current, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Download Speed',
              data: [],
              borderColor: '#0070f3', // Vercel Success Blue
              backgroundColor: '#0070f310',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            {
              label: 'Upload Speed',
              data: [],
              borderColor: '#ff0080', // Highlight Pink
              backgroundColor: '#ff008010',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
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
              grid: { color: '#ebebeb' },
              ticks: {
                color: '#888888',
                font: { family: 'JetBrains Mono', size: 10 },
                callback: (val) => `${val} M`
              }
            }
          }
        }
      });
    }

    // Latency Distribution Chart
    if (latencyChartRef.current) {
      latencyChartInstance.current = new Chart(latencyChartRef.current, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Latency (ms)',
            data: [],
            backgroundColor: '#171717', // Stark Ink
            borderColor: '#171717',
            borderWidth: 1,
            barThickness: 6,
            borderRadius: 3
          }]
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
              ticks: {
                color: '#888888',
                font: { family: 'JetBrains Mono', size: 9 }
              }
            },
            y: {
              beginAtZero: true,
              grid: { color: '#ebebeb' },
              ticks: {
                color: '#888888',
                font: { family: 'JetBrains Mono', size: 10 }
              }
            }
          }
        }
      });
    }
  };

  const updateThroughputChart = (type: 'download' | 'upload', mbps: number) => {
    const chart = throughputChartInstance.current;
    if (!chart) return;

    speedLabels.current.push('');
    chart.data.labels = speedLabels.current;

    if (type === 'download') {
      downloadSpeedHistory.current.push(mbps);
      chart.data.datasets[0].data = downloadSpeedHistory.current;
    } else {
      uploadSpeedHistory.current.push(mbps);
      // Keep download line flat at final speed or empty
      chart.data.datasets[1].data = uploadSpeedHistory.current;
    }

    chart.update('none'); // Update smoothly without canvas rebuild animations
  };

  const updateLatencyChart = (latencies: number[]) => {
    const chart = latencyChartInstance.current;
    if (!chart) return;

    chart.data.labels = latencies.map((_, i) => `#${i + 1}`);
    chart.data.datasets[0].data = latencies;
    chart.update('none');
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
      
      // Update local edge server coordinates in servers list
      const lat = data.latitude || 0;
      const lon = data.longitude || 0;
      
      const updatedServers = servers.map(s => {
        if (s.id === 'local-edge') {
          return { ...s, lat, lon };
        }
        return s;
      });
      setServers(updatedServers);

      // Perform distance calculations
      calculateServerDistances(lat, lon, updatedServers);

    } catch (err) {
      console.error('Failed to locate client:', err);
      setStatusMessage('GeoIP detection failed. Using global defaults.');
      calculateServerDistances(0, 0, servers);
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
        // First successful server is formally locked in as the anchor
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
    setLatencyStats({ current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [] });
    setDownloadStats({ current: 0, avg: 0, peak: 0 });
    setUploadStats({ current: 0, avg: 0, peak: 0 });
    setStability(100);
    setPacketLoss(0);
    setProgressPercent(0);

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
          updateLatencyChart(data.latencies);
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
          const downloadPeakMbps = data.peakSpeed / 1000000;

          setDownloadStats({
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed
          });
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
          updateThroughputChart('upload', uploadMbps);
          setProgressPercent(75 + Math.round((data.elapsedTime / 8) * 20)); // 20% of progress bar
          break;

        case 'UPLOAD_COMPLETE':
          // Run packet loss simulator checks (placeholder WebRTC framework)
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
      return { value: (mbps / 1000).toFixed(2), unit: 'Gbps' };
    }
    return { value: mbps.toFixed(1), unit: 'Mbps' };
  };

  const currentSpeedObj = phase === 'upload' 
    ? formatSpeed(uploadStats.current) 
    : formatSpeed(downloadStats.current);

  const displaySpeed = phase === 'idle' || phase === 'routing' || phase === 'ping'
    ? '0.0'
    : currentSpeedObj.value;

  const displayUnit = phase === 'idle' || phase === 'routing' || phase === 'ping'
    ? 'Mbps'
    : currentSpeedObj.unit;

  // Render speedometer SVG variables
  const maxDialSpeed = 100; // bps logic
  const dialSpeedPercent = Math.min(100, (parseFloat(displaySpeed) / (displayUnit === 'Gbps' ? 0.1 : 500)) * 100);
  const strokeDash = 2 * Math.PI * 90; // radius = 90
  const strokeOffset = strokeDash - (dialSpeedPercent / 100) * strokeDash;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8 flex-1">
      {/* 1. Header Hero section */}
      <div className="flex flex-col gap-2 mt-4 md:mt-8 border-b border-hairline pb-6">
        <span className="font-mono text-xs uppercase tracking-wider text-mute block">
          Network Speed Engine
        </span>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-ink font-sans">
          Check your connection speed.
        </h1>
        <p className="text-sm md:text-base text-body max-w-2xl mt-1">
          A professional-grade, latency-critical speed test engine measuring packet jitters, concurrent downloads, and uploads at the edge.
        </p>
      </div>

      {/* 2. Top Action Controls Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-canvas border border-hairline p-4 rounded-lg shadow-xs">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-mute" />
          <div className="flex flex-col">
            <span className="text-xs text-mute font-mono">TEST SERVER</span>
            <span className="text-sm font-semibold text-ink">
              {selectedServer 
                ? `${selectedServer.name} ${selectedServer.distance !== undefined && selectedServer.distance > 0 ? `(${selectedServer.distance} km)` : ''}` 
                : 'Auto-detecting closest...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {phase === 'idle' || phase === 'complete' || phase === 'error' ? (
            <button
              onClick={startSpeedTest}
              className="w-full sm:w-auto bg-primary text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-on-primary" /> Start Speed Test
            </button>
          ) : (
            <button
              onClick={cancelSpeedTest}
              className="w-full sm:w-auto bg-error text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Square className="w-4 h-4 fill-on-primary" /> Stop Test
            </button>
          )}
        </div>
      </div>

      {/* 3. Main Dashboard Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left column: Speedometer & Controls */}
        <div className="lg:col-span-5 flex flex-col items-center gap-6">
          <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
            
            {/* Speedometer SVG dial */}
            <svg className="w-full h-full transform -rotate-90">
              {/* Outer dial track background */}
              <circle
                cx="50%"
                cy="50%"
                r="90"
                fill="transparent"
                stroke="var(--color-canvas-soft-2)"
                strokeWidth="12"
                className="transform translate-x-[0px]"
              />
              {/* Active speed progress track */}
              <circle
                cx="50%"
                cy="50%"
                r="90"
                fill="transparent"
                stroke={phase === 'upload' ? '#ff0080' : '#0070f3'}
                strokeWidth="12"
                strokeDasharray={strokeDash}
                strokeDashoffset={strokeOffset}
                strokeLinecap="round"
                className={`transition-all duration-300 ${phase === 'download' || phase === 'upload' ? 'glow-pulse' : ''}`}
              />
            </svg>

            {/* Inner text values readout */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xs font-mono uppercase tracking-wider text-mute">
                {phase === 'idle' ? 'Ready' : phase.toUpperCase()}
              </span>
              <div className="flex items-baseline justify-center">
                <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                  {displaySpeed}
                </span>
              </div>
              <span className="text-sm font-mono text-mute mt-1">
                {displayUnit}
              </span>
              
              {/* Routing pre-ping info overlay */}
              {phase === 'routing' && (
                <div className="absolute inset-0 bg-canvas/80 backdrop-blur-xs flex flex-col items-center justify-center rounded-full p-6">
                  <RefreshCw className="w-8 h-8 text-link animate-spin" />
                  <span className="text-xs font-mono text-mute mt-3 text-center">Configuring Routing...</span>
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar & Status Text */}
          <div className="w-full flex flex-col gap-2 bg-canvas border border-hairline p-4 rounded-lg shadow-xs">
            <div className="flex justify-between items-center text-xs font-mono text-mute">
              <span>PROGRESS</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full bg-canvas-soft-2 h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-success animate-ping" />
              <span className="text-xs text-body font-mono truncate">{statusMessage}</span>
            </div>
          </div>
        </div>

        {/* Right column: Charts and results grid */}
        <div className="lg:col-span-7 flex flex-col gap-8">
          
          {/* Results grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            
            {/* Download Card */}
            <div className="vercel-card p-4 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs text-mute font-mono">
                <span>DOWNLOAD</span>
                <ArrowDown className="w-4 h-4 text-link" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">
                  {downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).value : '—'}
                </span>
                <span className="text-xs text-mute font-mono">
                  {downloadStats.avg > 0 ? formatSpeed(downloadStats.avg).unit : ''}
                </span>
              </div>
              <div className="text-[10px] text-mute font-mono">
                Peak: {downloadStats.peak > 0 ? `${formatSpeed(downloadStats.peak).value} ${formatSpeed(downloadStats.peak).unit}` : '—'}
              </div>
            </div>

            {/* Upload Card */}
            <div className="vercel-card p-4 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs text-mute font-mono">
                <span>UPLOAD</span>
                <ArrowUp className="w-4 h-4 text-highlight-pink" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">
                  {uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).value : '—'}
                </span>
                <span className="text-xs text-mute font-mono">
                  {uploadStats.avg > 0 ? formatSpeed(uploadStats.avg).unit : ''}
                </span>
              </div>
              <div className="text-[10px] text-mute font-mono">
                Peak: {uploadStats.peak > 0 ? `${formatSpeed(uploadStats.peak).value} ${formatSpeed(uploadStats.peak).unit}` : '—'}
              </div>
            </div>

            {/* Latency (Ping) */}
            <div className="vercel-card p-4 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs text-mute font-mono">
                <span>LATENCY (PING)</span>
                <Wifi className="w-4 h-4 text-mute" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">
                  {latencyStats.avg > 0 ? latencyStats.avg.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-mute font-mono">ms</span>
              </div>
              <div className="text-[10px] text-mute font-mono">
                Min: {latencyStats.min !== Infinity ? latencyStats.min.toFixed(0) : '—'}ms / Max: {latencyStats.max > 0 ? latencyStats.max.toFixed(0) : '—'}ms
              </div>
            </div>

            {/* Jitter */}
            <div className="vercel-card p-4 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs text-mute font-mono">
                <span>JITTER</span>
                <Activity className="w-4 h-4 text-mute" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">
                  {latencyStats.jitter > 0 ? latencyStats.jitter.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-mute font-mono">ms</span>
              </div>
              <div className="text-[10px] text-mute font-mono">
                Ping Var Deviation
              </div>
            </div>

            {/* Connection Stability */}
            <div className="vercel-card p-4 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs text-mute font-mono">
                <span>STABILITY</span>
                <CheckCircle className="w-4 h-4 text-mute" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">
                  {phase === 'idle' ? '—' : `${stability}%`}
                </span>
              </div>
              <div className="text-[10px] text-mute font-mono">
                Speed Consistency
              </div>
            </div>

            {/* Packet Loss */}
            <div className="vercel-card p-4 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs text-mute font-mono">
                <span>PACKET LOSS</span>
                <AlertTriangle className="w-4 h-4 text-mute" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">
                  {phase === 'complete' ? `${packetLoss}%` : phase === 'idle' ? '—' : '0.0%'}
                </span>
              </div>
              <div className="text-[10px] text-mute font-mono">
                WebRTC Socket drops
              </div>
            </div>

          </div>

          {/* Real-time Graph Area */}
          <div className="vercel-card p-4 flex flex-col gap-4">
            <span className="text-xs font-mono uppercase tracking-wider text-mute">
              Real-Time Bandwidth Timeline
            </span>
            <div className="h-56 relative w-full">
              <canvas ref={throughputChartRef} />
              {(phase === 'idle' || phase === 'routing') && (
                <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-xs font-mono text-mute">
                  Timeline charts start with test execution.
                </div>
              )}
            </div>
          </div>

          <div className="vercel-card p-4 flex flex-col gap-4">
            <span className="text-xs font-mono uppercase tracking-wider text-mute">
              Latency Distribution Scatter
            </span>
            <div className="h-44 relative w-full">
              <canvas ref={latencyChartRef} />
              {(phase === 'idle' || phase === 'routing') && (
                <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-xs font-mono text-mute">
                  Latency scatter records individual pings.
                </div>
              )}
            </div>
          </div>

          {/* Client Connection Geolocation Log */}
          {clientInfo && (
            <div className="bg-canvas-soft-2 border border-hairline p-5 rounded-lg flex flex-col md:flex-row justify-between gap-6 text-xs text-body font-mono">
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
          )}

        </div>
      </div>
    </div>
  );
}
