import { useState, useEffect, useRef, useCallback } from "react";
import type {
  TestPhase,
  LatencyStats,
  SpeedStats,
  ClientInfo,
  DetailPingStats,
  SpeedTestRequest,
} from "../../utils/speedTestUtils";
import {
  sleep,
  isLocalHost,
  calculateTrimmedMean,
  calculateMin,
  getAdaptiveStreamCount,
} from "../../utils/speedTestUtils";
import { CONFIG } from "../../utils/speedTestConfig";

// Lazy-loaded Chart.js module — only loaded when first test starts
let ChartJSModule: typeof import("chart.js") | null = null;
let ChartJSInstance: any = null;

async function ensureChartJS() {
  if (ChartJSModule) return ChartJSModule;
  ChartJSModule = await import("chart.js");
  ChartJSInstance = ChartJSModule.Chart;
  ChartJSInstance.register(
    ChartJSModule.CategoryScale,
    ChartJSModule.LinearScale,
    ChartJSModule.PointElement,
    ChartJSModule.LineElement,
    ChartJSModule.LineController,
    ChartJSModule.Filler,
    ChartJSModule.Tooltip,
    ChartJSModule.Legend,
  );
  return ChartJSModule;
}

export interface TerminalLogEntry {
  text: string;
  style?: "command" | "ok" | "probe" | "error" | "default";
}

export interface UseSpeedTestReturn {
  phase: TestPhase;
  statusMessage: string;
  activeTab: "latency" | "packetLoss" | "download" | "upload";
  setActiveTab: (tab: "latency" | "packetLoss" | "download" | "upload") => void;
  clientInfo: ClientInfo | null;
  latencyStats: LatencyStats;
  downloadStats: SpeedStats;
  uploadStats: SpeedStats;
  packetLoss: number;
  terminalLogs: string[];
  activeProgressLine: string | null;
  cliInput: string;
  setCliInput: (v: string) => void;
  handleCliSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  dlLoadedLatency: number;
  dlLoadedJitter: number;
  ulLoadedLatency: number;
  ulLoadedJitter: number;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
  downloadRequests: SpeedTestRequest[];
  uploadRequests: SpeedTestRequest[];
  downloadReliable: boolean;
  uploadReliable: boolean;
  completionTime: string;
  progressPercent: number;
  startSpeedTest: () => Promise<void>;
  cancelSpeedTest: () => void;
  downloadTestResult: () => void;
  terminalBodyRef: React.RefObject<HTMLDivElement | null>;
  downloadChartRef: React.RefObject<HTMLCanvasElement | null>;
  uploadChartRef: React.RefObject<HTMLCanvasElement | null>;
}

const OPTIMAL_SERVER = { id: "cloudflare-optimal", name: "Cloudflare Optimal Server", region: "auto" };

export function useSpeedTest(): UseSpeedTestReturn {
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("System ready.");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeTab, setActiveTab] = useState<"latency" | "packetLoss" | "download" | "upload">("latency");
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);

  const [latencyStats, setLatencyStats] = useState<LatencyStats>({
    current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [],
  });
  const [downloadStats, setDownloadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [uploadStats, setUploadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [packetLoss, setPacketLoss] = useState<number>(0);

  const MAX_LOG_ENTRIES = 500;
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "Welcome to Net-Speed CLI v0.1.1",
    "System ready. Click 'Start Speed Test' or type 'run' in terminal.",
  ]);
  const appendLogs = useCallback((newLogs: string[]) => {
    setTerminalLogs((prev) => {
      const combined = [...prev, ...newLogs];
      return combined.length > MAX_LOG_ENTRIES ? combined.slice(-MAX_LOG_ENTRIES) : combined;
    });
  }, []);
  const [activeProgressLine, setActiveProgressLine] = useState<string | null>(null);
  const [cliInput, setCliInput] = useState("");
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

  const [dlLoadedLatency, setDlLoadedLatency] = useState<number>(0);
  const [dlLoadedJitter, setDlLoadedJitter] = useState<number>(0);
  const [ulLoadedLatency, setUlLoadedLatency] = useState<number>(0);
  const [ulLoadedJitter, setUlLoadedJitter] = useState<number>(0);

  const [unloadedPingStats, setUnloadedPingStats] = useState<DetailPingStats>({ sent: 0, lost: 0, latencies: [] });
  const [dlLoadedPingStats, setDlLoadedPingStats] = useState<DetailPingStats>({ sent: 0, lost: 0, latencies: [] });
  const [ulLoadedPingStats, setUlLoadedPingStats] = useState<DetailPingStats>({ sent: 0, lost: 0, latencies: [] });
  const [downloadRequests, setDownloadRequests] = useState<SpeedTestRequest[]>([]);
  const [uploadRequests, setUploadRequests] = useState<SpeedTestRequest[]>([]);
  const [downloadReliable, setDownloadReliable] = useState(true);
  const [uploadReliable, setUploadReliable] = useState(true);
  const [completionTime, setCompletionTime] = useState<string>("");
  const [progressPercent, setProgressPercent] = useState(0);

  // Consolidated mutable refs — single object to avoid stale closures in worker callbacks
  const stateRef = useRef({
    downloadStats: { current: 0, avg: 0, peak: 0 } as SpeedStats,
    uploadStats: { current: 0, avg: 0, peak: 0 } as SpeedStats,
    latencyStats: { current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [] } as LatencyStats,
    unloadedPingStats: { sent: 0, lost: 0, latencies: [] } as DetailPingStats,
    dlLoadedPingStats: { sent: 0, lost: 0, latencies: [] } as DetailPingStats,
    ulLoadedPingStats: { sent: 0, lost: 0, latencies: [] } as DetailPingStats,
    downloadRequests: [] as SpeedTestRequest[],
    uploadRequests: [] as SpeedTestRequest[],
    clientInfo: null as ClientInfo | null,
  });

  const workerRef = useRef<Worker | null>(null);
  const downloadChartRef = useRef<HTMLCanvasElement | null>(null);
  const uploadChartRef = useRef<HTMLCanvasElement | null>(null);
  const downloadChartInstance = useRef<any | null>(null);
  const uploadChartInstance = useRef<any | null>(null);
  const downloadSpeedHistory = useRef<number[]>([]);
  const uploadSpeedHistory = useRef<number[]>([]);
  const autorunTriggered = useRef(false);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [terminalLogs, activeProgressLine]);

  // Initialize client location and theme
  useEffect(() => {
    detectClientLocation();
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setTheme(customEvent.detail.theme);
    };
    window.addEventListener("theme-changed", handleThemeChange);
    return () => {
      if (workerRef.current) workerRef.current.terminate();
      destroyCharts();
      window.removeEventListener("theme-changed", handleThemeChange);
    };
  }, []);

  // Auto-run on ?autorun=true
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("autorun") === "true" && !autorunTriggered.current && clientInfo !== null) {
      autorunTriggered.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("autorun");
      window.history.replaceState({}, document.title, url.pathname + url.search);
      startSpeedTest();
    }
  }, [clientInfo]);

  // Sync Chart.js theme colors
  useEffect(() => {
    const gridColor = theme === "dark" ? "#222222" : "#ebebeb";
    const textColor = theme === "dark" ? "#a1a1a1" : "#888888";
    for (const chart of [downloadChartInstance.current, uploadChartInstance.current]) {
      if (chart) {
        const opts = chart.options as any;
        if (opts.scales?.y) {
          opts.scales.y.grid.color = gridColor;
          opts.scales.y.ticks.color = textColor;
        }
        chart.update("none");
      }
    }
  }, [theme]);

  // --- Chart helpers (lazy-loaded) ---
  const destroyCharts = useCallback(() => {
    if (downloadChartInstance.current) {
      downloadChartInstance.current.destroy();
      downloadChartInstance.current = null;
    }
    if (uploadChartInstance.current) {
      uploadChartInstance.current.destroy();
      uploadChartInstance.current = null;
    }
  }, []);

  const initCharts = useCallback(async () => {
    destroyCharts();
    downloadSpeedHistory.current = [];
    uploadSpeedHistory.current = [];

    const mod = await ensureChartJS();
    const ChartClass = mod.Chart;
    const gridColor = theme === "dark" ? "#222222" : "#ebebeb";
    const textColor = theme === "dark" ? "#a1a1a1" : "#888888";

    if (downloadChartRef.current) {
      downloadChartInstance.current = new ChartClass(downloadChartRef.current, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Download Speed",
              data: [],
              borderColor: "#eb6f20",
              backgroundColor: "rgba(235, 111, 32, 0.08)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            {
              label: "90th Percentile",
              data: [],
              borderColor: theme === "dark" ? "#444444" : "#b5b5b5",
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { grid: { display: false }, ticks: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: { color: textColor, font: { family: "JetBrains Mono", size: 10 }, callback: (val: string | number) => `${val} M` },
            },
          },
        },
      });
    }

    if (uploadChartRef.current) {
      uploadChartInstance.current = new ChartClass(uploadChartRef.current, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Upload Speed",
              data: [],
              borderColor: "#8b5cf6",
              backgroundColor: "rgba(139, 92, 246, 0.08)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
            {
              label: "90th Percentile",
              data: [],
              borderColor: theme === "dark" ? "#444444" : "#b5b5b5",
              borderWidth: 1.5,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { grid: { display: false }, ticks: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: { color: textColor, font: { family: "JetBrains Mono", size: 10 }, callback: (val: string | number) => `${val} M` },
            },
          },
        },
      });
    }
  }, [theme, destroyCharts]);

  const updateThroughputChart = useCallback((type: "download" | "upload", mbps: number) => {
    const chart = type === "download" ? downloadChartInstance.current : uploadChartInstance.current;
    const history = type === "download" ? downloadSpeedHistory : uploadSpeedHistory;
    if (!chart) return;

    history.current.push(mbps);
    if (history.current.length > CONFIG.CHART_MAX_POINTS) history.current.shift();
    chart.data.labels = history.current.map(() => "");
    chart.data.datasets[0].data = history.current;

    const sorted = [...history.current].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    chart.data.datasets[1].data = history.current.map(() => p95);

    // Dynamic Y-axis scaling: set max to 1.3x the peak to prevent wasted space
    // while leaving headroom above the highest data point
    const currentMax = Math.max(...history.current, 0);
    const dynamicMax = Math.max(10, currentMax * 1.3);
    if (chart.options.scales?.y) {
      (chart.options.scales.y as any).max = dynamicMax;
    }

    chart.update("none");
  }, []);

  // --- Geolocation ---
  const getPreciseCoords = useCallback((): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setTerminalLogs((prev) => [...prev, "[INFO] High-accuracy geolocation obtained from device."]);
          resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) { resolve(null); return; }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setTerminalLogs((prev) => [...prev, "[INFO] Low-accuracy geolocation obtained from device."]);
              resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
            },
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 4000, maximumAge: Infinity },
          );
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 },
      );
    });
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lon: number) => {
    let city = "", region = "", countryCode = "";
    try {
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      if (res.ok) {
        const bdcData = await res.json();
        city = bdcData.city || bdcData.locality || "";
        region = bdcData.principalSubdivision || "";
        countryCode = bdcData.countryCode || "";
      }
    } catch (e) { console.warn("Reverse geocoding failed:", e); }
    return { city, region, countryCode };
  }, []);

  const upgradeToPreciseLocation = useCallback(async () => {
    const coords = await getPreciseCoords();
    if (!coords) return null;
    const { city, region, countryCode } = await reverseGeocode(coords.latitude, coords.longitude);
    let url = `/api/ip-geo?clientLat=${coords.latitude}&clientLon=${coords.longitude}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (region) url += `&region=${encodeURIComponent(region)}`;
    if (countryCode) url += `&countryCode=${encodeURIComponent(countryCode)}`;
    try {
      const geoRes = await fetch(url);
      if (geoRes.ok) {
        const data = await geoRes.json();
        const preciseData: ClientInfo = { ...data, isPrecise: true };
        setClientInfo(preciseData);
        stateRef.current.clientInfo = preciseData;
        setStatusMessage(`Precise location loaded: ${preciseData.city}, ${preciseData.country}`);
        appendLogs([`[OK] Precise location: ${preciseData.city}, ${preciseData.region}, ${preciseData.country}`]);
        return preciseData;
      }
    } catch (e) { console.warn("Precise location upgrade failed:", e); }
    return null;
  }, [getPreciseCoords, reverseGeocode, appendLogs]);

  const detectClientLocation = useCallback(async () => {
    try {
      let preGrantedCoords: { latitude: number; longitude: number } | null = null;
      let permissionStatus: PermissionStatus | null = null;

      if ("geolocation" in navigator && navigator.permissions) {
        try {
          permissionStatus = await navigator.permissions.query({ name: "geolocation" });
          if (permissionStatus.state === "granted") {
            preGrantedCoords = await getPreciseCoords();
          }
        } catch (e) { console.warn("Permissions API query failed:", e); }
      }

      setStatusMessage("Detecting location…");
      let url = "/api/ip-geo";
      if (preGrantedCoords) {
        const { city, region, countryCode } = await reverseGeocode(preGrantedCoords.latitude, preGrantedCoords.longitude);
        url = `/api/ip-geo?clientLat=${preGrantedCoords.latitude}&clientLon=${preGrantedCoords.longitude}`;
        if (city) url += `&city=${encodeURIComponent(city)}`;
        if (region) url += `&region=${encodeURIComponent(region)}`;
        if (countryCode) url += `&countryCode=${encodeURIComponent(countryCode)}`;
      }
      const geoRes = await fetch(url);
      let data = await geoRes.json();

      if (data.isLocal && !preGrantedCoords) {
        try {
          const ipRes = await fetch("https://api.ipify.org?format=json");
          if (ipRes.ok) {
            const ipData = await ipRes.json();
            if (ipData?.ip) {
              const upgradeRes = await fetch(`/api/ip-geo?ip=${ipData.ip}`);
              if (upgradeRes.ok) data = await upgradeRes.json();
            }
          }
        } catch (e) { console.warn("Client-side public IP lookup failed:", e); }
      }

      const initialData: ClientInfo = { ...data, isPrecise: !!preGrantedCoords };

      if ("connection" in navigator) {
        const conn = (navigator as any).connection;
        if (conn) {
          initialData.effectiveType = conn.effectiveType || undefined;
          initialData.downlink = conn.downlink || undefined;
          initialData.rtt = conn.rtt || undefined;
          if (conn.type) {
            initialData.connectionType = conn.type;
          } else if (conn.effectiveType) {
            const et = conn.effectiveType;
            if (et === "4g") initialData.connectionType = "cellular-4g";
            else if (et === "3g") initialData.connectionType = "cellular-3g";
            else if (et === "2g" || et === "slow-2g") initialData.connectionType = "cellular-2g";
            else initialData.connectionType = "unknown";
          }
          appendLogs([
            `[INFO] Connection: ${initialData.connectionType || "unknown"} (${initialData.effectiveType || "N/A"})`,
            initialData.downlink ? `[INFO] Estimated downlink: ${initialData.downlink} Mbps` : "",
            initialData.rtt ? `[INFO] Network RTT: ${initialData.rtt} ms` : "",
          ].filter(Boolean));
        }
      }

      setClientInfo(initialData);
      stateRef.current.clientInfo = initialData;
      setStatusMessage(preGrantedCoords ? `Precise location loaded: ${initialData.city}, ${initialData.country}` : `Client IP detected: ${initialData.ip}`);

      if (permissionStatus && permissionStatus.state === "prompt") {
        const onPermissionChange = async () => {
          if (permissionStatus!.state === "granted") {
            permissionStatus!.removeEventListener("change", onPermissionChange);
            appendLogs(["[INFO] Geolocation permission granted — fetching precise location…"]);
            await upgradeToPreciseLocation();
          } else if (permissionStatus!.state === "denied") {
            permissionStatus!.removeEventListener("change", onPermissionChange);
          }
        };
        permissionStatus.addEventListener("change", onPermissionChange);
      }
    } catch (err) {
      const defaultData = { ip: "0.0.0.0", city: "Unknown", region: "Unknown", country: "Unknown", org: "Unknown", latitude: 0, longitude: 0, isLocal: false, isPrecise: false };
      console.error("Failed to locate client:", err);
      setStatusMessage("GeoIP detection failed. Using global defaults.");
      setClientInfo(defaultData as any);
      stateRef.current.clientInfo = defaultData as any;
    }
  }, [appendLogs, getPreciseCoords, reverseGeocode, upgradeToPreciseLocation]);

  // --- Warmup ---
  const warmupServer = useCallback(async (): Promise<typeof OPTIMAL_SERVER> => {
    setPhase("routing");
    setProgressPercent(15);
    setStatusMessage("Selecting optimal server…");
    const origin = window.location.origin;
    let hostLatency = 0;
    try {
      const warmupUrl = `${origin}/api/ping?warmup=true&cb=${Date.now()}`;
      const startWarmup = performance.now();
      const res = await fetch(warmupUrl, { cache: "no-store" });
      await res.text();
      hostLatency = performance.now() - startWarmup;
    } catch (_) { hostLatency = 0; }
    if (isLocalHost(window.location.hostname)) hostLatency = Math.max(1.5, hostLatency);
    setTerminalLogs((prev) => [...prev, `[OK] Connected to optimal server (warmup: ${hostLatency.toFixed(1)}ms)`]);
    setStatusMessage(`Optimal server ready (${hostLatency.toFixed(1)}ms warmup)`);
    setProgressPercent(30);
    await sleep(200);
    return OPTIMAL_SERVER;
  }, []);

  // --- Speed Test Orchestrator ---
  const startSpeedTest = useCallback(async () => {
    if (phase !== "idle" && phase !== "complete" && phase !== "error") return;

    let currentClientInfo = stateRef.current.clientInfo;
    let clientLat = currentClientInfo?.latitude || 0;
    let clientLon = currentClientInfo?.longitude || 0;

    // Trigger browser geolocation if not precise
    if ("geolocation" in navigator && (!currentClientInfo || !currentClientInfo.isPrecise)) {
      setStatusMessage("Requesting browser geolocation for optimal server selection...");
      appendLogs(["[INFO] Requesting browser geolocation for high accuracy routing..."]);
      const upgraded = await upgradeToPreciseLocation();
      if (upgraded) {
        currentClientInfo = upgraded;
        clientLat = upgraded.latitude || 0;
        clientLon = upgraded.longitude || 0;
      }
    }

    // Reset all stats
    stateRef.current.downloadRequests = [];
    stateRef.current.uploadRequests = [];
    stateRef.current.unloadedPingStats = { sent: 0, lost: 0, latencies: [] };
    stateRef.current.dlLoadedPingStats = { sent: 0, lost: 0, latencies: [] };
    stateRef.current.ulLoadedPingStats = { sent: 0, lost: 0, latencies: [] };
    stateRef.current.latencyStats = { current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [] };
    stateRef.current.downloadStats = { current: 0, avg: 0, peak: 0 };
    stateRef.current.uploadStats = { current: 0, avg: 0, peak: 0 };

    setUnloadedPingStats({ sent: 0, lost: 0, latencies: [] });
    setDlLoadedPingStats({ sent: 0, lost: 0, latencies: [] });
    setUlLoadedPingStats({ sent: 0, lost: 0, latencies: [] });
    setDownloadRequests([]);
    setUploadRequests([]);
    setLatencyStats({ current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [] });
    setDownloadStats({ current: 0, avg: 0, peak: 0 });
    setUploadStats({ current: 0, avg: 0, peak: 0 });
    setDlLoadedLatency(0);
    setDlLoadedJitter(0);
    setUlLoadedLatency(0);
    setUlLoadedJitter(0);
    setPacketLoss(0);
    setProgressPercent(0);
    setCompletionTime("");
    setDownloadReliable(true);
    setUploadReliable(true);

    setTerminalLogs([
      "Welcome to Net-Speed CLI v0.1.1",
      "System ready. Initializing speedtest...",
      `$ speedtest`,
      `Client IP: ${currentClientInfo?.ip || "Detecting..."} (${currentClientInfo?.org || "Detecting..."})`,
      `Location: ${currentClientInfo?.city || "Detecting..."}, ${currentClientInfo?.region || ""}, ${currentClientInfo?.country || ""}`,
      "Selecting optimal server (Anycast BGP routing)...",
    ]);
    setActiveProgressLine(null);

    const edgeNode = await warmupServer();
    await initCharts();
    setPhase("ping");
    setStatusMessage("Pinging optimal server…");
    setProgressPercent(40);

    setTerminalLogs((prev) => [
      ...prev, "",
      `$ ping -c 15 ${edgeNode.id}`,
      `PING ${edgeNode.name} 56(84) bytes of data.`,
    ]);

    const origin = window.location.origin;
    const baseUrl = `${origin}/api`;
    const region = edgeNode.region;

    workerRef.current = new Worker(
      new URL("../../workers/speedtest.worker.ts", import.meta.url),
      { type: "module" },
    );

    workerRef.current.onmessage = (e: MessageEvent) => {
      const { type, ...data } = e.data;

      switch (type) {
        case "PING_PROGRESS": {
          const stats = { sent: data.pingSent || data.iteration, lost: data.pingLost || 0, latencies: data.latencies || [] };
          stateRef.current.unloadedPingStats = stats;
          setUnloadedPingStats(stats);
          const newLatencyStats = {
            current: data.latency,
            avg: calculateTrimmedMean(data.latencies),
            jitter: data.jitter,
            min: calculateMin(data.latencies),
            max: Math.max(...data.latencies),
            latencies: data.latencies,
          };
          setLatencyStats(newLatencyStats);
          stateRef.current.latencyStats = newLatencyStats;
          setProgressPercent(40 + Math.round((data.iteration / data.totalIterations) * 10));
          setTerminalLogs((prev) => [...prev, `64 bytes from ${edgeNode.id}: icmp_seq=${data.iteration} time=${data.latency.toFixed(1)} ms`]);
          break;
        }

        case "PING_COMPLETE": {
          const stats = { sent: data.pingSent || data.latencies.length, lost: data.pingLost || 0, latencies: data.latencies || [] };
          stateRef.current.unloadedPingStats = stats;
          setUnloadedPingStats(stats);
          setProgressPercent(50);
          setPhase("download");
          setStatusMessage("Measuring download throughput (concurrent streams)…");

          const pings = data.latencies || [];
          const min = pings.length > 0 ? calculateMin(pings) : 0;
          const avg = pings.length > 0 ? calculateTrimmedMean(pings) : 0;
          const max = pings.length > 0 ? Math.max(...pings) : 0;
          const jitter = data.jitter || 0;
          const loss = data.pingSent > 0 ? ((data.pingLost / data.pingSent) * 100).toFixed(1) : "0.0";

          const estimatedBandwidthBps = avg > 0 ? 10_000_000 : 5_000_000;
          const rttSec = avg / 1000;
          const bdpBytes = estimatedBandwidthBps * rttSec;
          const dynamicWarmupMs = Math.min(CONFIG.DYNAMIC_WARMUP_MAX_MS, Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil((bdpBytes * 2 / estimatedBandwidthBps) * 1000)));
          const dynamicRampMs = Math.min(CONFIG.DYNAMIC_RAMP_MAX_MS, Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil((bdpBytes * 4 / estimatedBandwidthBps) * 1000)));
          const adaptiveStreams = getAdaptiveStreamCount(estimatedBandwidthBps, CONFIG.PARALLEL_STREAMS_DEFAULT, CONFIG.BANDWIDTH_SLOW_THRESHOLD, CONFIG.BANDWIDTH_MEDIUM_THRESHOLD, CONFIG.PARALLEL_STREAMS_SLOW, CONFIG.PARALLEL_STREAMS_MEDIUM, CONFIG.PARALLEL_STREAMS_FAST);

          setTerminalLogs((prev) => [
            ...prev,
            `--- ${edgeNode.id} ping statistics ---`,
            `${data.pingSent} packets transmitted, ${data.pingSent - data.pingLost} received, ${loss}% packet loss`,
            `rtt min/avg/max/mdev = ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)}/${jitter.toFixed(1)} ms`,
            `[INFO] BDP estimate: ${(bdpBytes / 1024).toFixed(1)} KB, warmup: ${dynamicWarmupMs}ms, ramp: ${dynamicRampMs}ms`,
            `[INFO] Adaptive streams: ${adaptiveStreams} (conservative 10 Mbps estimate)`,
            "",
            `$ speedtest --download --streams=${adaptiveStreams}`,
            `Starting download throughput test (${adaptiveStreams} streams, ~${((dynamicWarmupMs + dynamicRampMs + CONFIG.DOWNLOAD_MEASURE_MS + CONFIG.DOWNLOAD_PEAK_MS) / 1000).toFixed(0)}s window)...`,
          ]);

          const calculatedAvgPing = avg > 0 ? avg : 20;
          workerRef.current?.postMessage({ type: "START_DOWNLOAD", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon, basePing: calculatedAvgPing, parallelStreams: adaptiveStreams, dynamicWarmupMs, dynamicRampMs });
          break;
        }

        case "DOWNLOAD_PROGRESS": {
          const downloadMbps = data.instantaneousSpeed / 1000000;
          const newDownloadStats = { current: data.instantaneousSpeed, avg: data.averageSpeed, peak: data.peakSpeed };
          setDownloadStats(newDownloadStats);
          stateRef.current.downloadStats = newDownloadStats;
          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);
          updateThroughputChart("download", downloadMbps);
          const dlPct = Math.min(100, Math.round((data.elapsedTime / 20) * 100));
          const dlBarLen = Math.floor(dlPct / 5);
          const dlBar = "█".repeat(dlBarLen) + " ".repeat(20 - dlBarLen);
          setActiveProgressLine(`Download: ${downloadMbps.toFixed(1)} Mbps [${dlBar}] ${dlPct}% (${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB transferred)`);
          setProgressPercent(Math.min(74, 50 + Math.round((data.elapsedTime / 20) * 25)));
          if (data.loadedLatencies) {
            const stats = { sent: data.loadedPingSent || 0, lost: data.loadedPingLost || 0, latencies: data.loadedLatencies || [] };
            stateRef.current.dlLoadedPingStats = stats;
            setDlLoadedPingStats(stats);
          }
          if (data.requests) {
            stateRef.current.downloadRequests = data.requests;
            setDownloadRequests(data.requests);
          }
          break;
        }

        case "DOWNLOAD_COMPLETE": {
          const stats = { sent: data.loadedPingSent || 0, lost: data.loadedPingLost || 0, latencies: data.loadedLatencies || [] };
          stateRef.current.dlLoadedPingStats = stats;
          setDlLoadedPingStats(stats);
          const newDownloadStats = { current: 0, avg: data.averageSpeed, peak: data.peakSpeed };
          setDownloadStats(newDownloadStats);
          stateRef.current.downloadStats = newDownloadStats;
          if (data.reliable === false) setDownloadReliable(false);
          setProgressPercent(75);
          setPhase("upload");
          setStatusMessage("Measuring upload throughput (concurrent streams)…");
          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);
          if (data.requests) {
            stateRef.current.downloadRequests = data.requests;
            setDownloadRequests(data.requests);
          }

          const finalDlMbps = data.averageSpeed / 1000000;
          const reliabilityNote = data.reliable === false ? " [UNRELIABLE - insufficient data]" : "";
          const pings = stateRef.current.unloadedPingStats.latencies || [];
          const calculatedAvgPing = pings.length > 0 ? calculateTrimmedMean(pings) : 20;
          // Use a conservative 10 Mbps default for BDP estimation.
          // navigator.connection.downlink is unreliable and the actual bandwidth
          // is now known from the download test, but we use the same conservative
          // default for consistency with the upload warmup calibration.
          const estimatedBandwidthBps = calculatedAvgPing > 0 ? 10_000_000 : 5_000_000;
          const rttSec = calculatedAvgPing / 1000;
          const bdpBytes = estimatedBandwidthBps * rttSec;
          const dynamicWarmupMs = Math.min(CONFIG.DYNAMIC_WARMUP_MAX_MS, Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil((bdpBytes * 2 / estimatedBandwidthBps) * 1000)));
          const dynamicRampMs = Math.min(CONFIG.DYNAMIC_RAMP_MAX_MS, Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil((bdpBytes * 4 / estimatedBandwidthBps) * 1000)));
          const adaptiveStreams = getAdaptiveStreamCount(estimatedBandwidthBps, CONFIG.PARALLEL_STREAMS_DEFAULT, CONFIG.BANDWIDTH_SLOW_THRESHOLD, CONFIG.BANDWIDTH_MEDIUM_THRESHOLD, CONFIG.PARALLEL_STREAMS_SLOW, CONFIG.PARALLEL_STREAMS_MEDIUM, CONFIG.PARALLEL_STREAMS_FAST);

          setTerminalLogs((prev) => [
            ...prev,
            `Download: ${finalDlMbps.toFixed(1)} Mbps${reliabilityNote} [████████████████████] 100% (Total: ${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
            `[OK] Download test finished.`,
            "",
            `$ speedtest --upload --streams=${adaptiveStreams}`,
            `Starting upload throughput test (${adaptiveStreams} streams, ~${((dynamicWarmupMs + dynamicRampMs + CONFIG.UPLOAD_MEASURE_MS + CONFIG.UPLOAD_PEAK_MS) / 1000).toFixed(0)}s window)...`,
          ]);
          setActiveProgressLine(null);

          workerRef.current?.postMessage({ type: "START_UPLOAD", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon, basePing: calculatedAvgPing, parallelStreams: adaptiveStreams, downloadSpeed: stateRef.current.downloadStats.avg, dynamicWarmupMs, dynamicRampMs });
          break;
        }

        case "UPLOAD_PROGRESS": {
          const uploadMbps = data.instantaneousSpeed / 1000000;
          const newUploadStats = { current: data.instantaneousSpeed, avg: data.averageSpeed, peak: data.peakSpeed };
          setUploadStats(newUploadStats);
          stateRef.current.uploadStats = newUploadStats;
          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);
          updateThroughputChart("upload", uploadMbps);
          const ulPct = Math.min(100, Math.round((data.elapsedTime / 20) * 100));
          const ulBarLen = Math.floor(ulPct / 5);
          const ulBar = "█".repeat(ulBarLen) + " ".repeat(20 - ulBarLen);
          setActiveProgressLine(`Upload: ${uploadMbps.toFixed(1)} Mbps [${ulBar}] ${ulPct}% (${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB transferred)`);
          setProgressPercent(Math.min(99, 75 + Math.round((data.elapsedTime / 20) * 20)));
          if (data.loadedLatencies) {
            const stats = { sent: data.loadedPingSent || 0, lost: data.loadedPingLost || 0, latencies: data.loadedLatencies || [] };
            stateRef.current.ulLoadedPingStats = stats;
            setUlLoadedPingStats(stats);
          }
          if (data.requests) {
            stateRef.current.uploadRequests = data.requests;
            setUploadRequests(data.requests);
          }
          break;
        }

        case "UPLOAD_COMPLETE": {
          const stats = { sent: data.loadedPingSent || 0, lost: data.loadedPingLost || 0, latencies: data.loadedLatencies || [] };
          stateRef.current.ulLoadedPingStats = stats;
          setUlLoadedPingStats(stats);
          const newUploadStats = { current: 0, avg: data.averageSpeed, peak: data.peakSpeed };
          setUploadStats(newUploadStats);
          stateRef.current.uploadStats = newUploadStats;
          if (data.reliable === false) setUploadReliable(false);
          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);
          if (data.requests) {
            stateRef.current.uploadRequests = data.requests;
            setUploadRequests(data.requests);
          }

          const finalUlMbps = data.averageSpeed / 1000000;
          const reliabilityNote = data.reliable === false ? " [UNRELIABLE - insufficient data]" : "";
          setTerminalLogs((prev) => [
            ...prev,
            `Upload: ${finalUlMbps.toFixed(1)} Mbps${reliabilityNote} [████████████████████] 100% (Total: ${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
            `[OK] Upload test finished.`,
            "",
            `$ ping -c ${CONFIG.PACKET_LOSS_PINGS} --interval=${CONFIG.PACKET_LOSS_INTERVAL_MS}ms ${edgeNode.id}`,
            `Running dedicated packet loss test (${CONFIG.PACKET_LOSS_PINGS} pings)...`,
          ]);
          setActiveProgressLine(null);
          setPhase("packetLoss");
          setStatusMessage("Measuring packet loss...");
          workerRef.current?.postMessage({ type: "START_PACKET_LOSS", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon });
          break;
        }

        case "PACKET_LOSS_PROGRESS": {
          setTerminalLogs((prev) => [...prev, `64 bytes from ${edgeNode.id}: icmp_seq=${data.iteration} loss=${data.lost}/${data.sent}`]);
          break;
        }

        case "PACKET_LOSS_COMPLETE": {
          setPacketLoss(parseFloat(data.lossPercent.toFixed(1)));
          setTerminalLogs((prev) => [
            ...prev,
            `--- ${edgeNode.id} packet loss statistics ---`,
            `${data.sent} pings transmitted, ${data.sent - data.lost} received, ${data.lossPercent.toFixed(1)}% packet loss`,
            "",
          ]);
          runPacketLossCheck(data.lossPercent);
          break;
        }

        case "CANCELLED":
          setPhase("idle");
          setStatusMessage("Speed test stopped by user.");
          setTerminalLogs((prev) => [...prev, "[ERROR] Speed test stopped by user.", "$"]);
          break;

        case "ERROR":
          setPhase("error");
          setStatusMessage(`Test failure: ${data.message}`);
          setTerminalLogs((prev) => [...prev, `[ERROR] Test failure: ${data.message}`, "$"]);
          break;
      }
    };

    workerRef.current.postMessage({ type: "START_PING", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon });
  }, [phase, appendLogs, getPreciseCoords, upgradeToPreciseLocation, warmupServer, initCharts, updateThroughputChart]);

  const runPacketLossCheck = useCallback((realLossPercent: number) => {
    setPhase("complete");
    setProgressPercent(100);
    setStatusMessage("Speed test complete.");
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setCompletionTime(timeStr);
    setPacketLoss(realLossPercent);
    setTerminalLogs((prev) => [
      ...prev,
      "--------------------------------------------------",
      `Speedtest execution finished at ${timeStr}`,
      `Server: ${OPTIMAL_SERVER.name}`,
      `  Download Speed: ${(stateRef.current.downloadStats.avg / 1000000).toFixed(1)} Mbps`,
      `  Upload Speed: ${(stateRef.current.uploadStats.avg / 1000000).toFixed(1)} Mbps`,
      `  Latency (unloaded): ${stateRef.current.latencyStats.avg.toFixed(1)} ms`,
      `  Jitter: ${stateRef.current.latencyStats.jitter.toFixed(1)} ms`,
      `  Packet Loss: ${realLossPercent.toFixed(1)}%`,
      "--------------------------------------------------",
      "$",
    ]);
    if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
  }, []);

  const cancelSpeedTest = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "CANCEL" });
      return;
    }
    setPhase("idle");
    setStatusMessage("Test cancelled.");
  }, []);

  const downloadTestResult = useCallback(() => {
    const allRequests = [...stateRef.current.downloadRequests, ...stateRef.current.uploadRequests].sort((a, b) => a.time - b.time);
    const headers = ["time", "direction", "bytes", "latency", "bps", "duration", "serverTime", "responseSize", "loadedLatencies"];
    const csvRows = [headers.join(",")];
    for (const req of allRequests) {
      const pingsStr = req.loadedLatencies?.length > 0 ? req.loadedLatencies.join(" ") : "";
      csvRows.push([req.time, req.direction, req.bytes, req.latency, req.bps, req.duration, req.serverTime, req.responseSize, pingsStr].join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `speed-results-${Math.floor(Date.now() / 1000)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleCliSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cmd = cliInput.trim().toLowerCase();
    if (!cmd) return;
    appendLogs([`$ ${cliInput}`]);
    setCliInput("");
    if (cmd === "clear") {
      setTerminalLogs([]);
      setActiveProgressLine(null);
    } else if (cmd === "help") {
      appendLogs(["Available commands:", "  run, speedtest  - Start the network speed test", "  clear           - Clear the terminal screen", "  help            - Show this help message"]);
    } else if (cmd === "run" || cmd === "speedtest") {
      if (phase !== "idle" && phase !== "complete" && phase !== "error") {
        appendLogs(["Error: A speed test is already running."]);
      } else {
        startSpeedTest();
      }
    } else {
      appendLogs([`Unknown command: ${cmd}. Type 'help' for options.`]);
    }
  }, [cliInput, phase, appendLogs, startSpeedTest]);

  return {
    phase, statusMessage, activeTab, setActiveTab,
    clientInfo, latencyStats, downloadStats, uploadStats, packetLoss,
    terminalLogs, activeProgressLine, cliInput, setCliInput, handleCliSubmit,
    dlLoadedLatency, dlLoadedJitter, ulLoadedLatency, ulLoadedJitter,
    unloadedPingStats, dlLoadedPingStats, ulLoadedPingStats,
    downloadRequests, uploadRequests, downloadReliable, uploadReliable,
    completionTime, progressPercent,
    startSpeedTest, cancelSpeedTest, downloadTestResult,
    terminalBodyRef, downloadChartRef, uploadChartRef,
  };
}
