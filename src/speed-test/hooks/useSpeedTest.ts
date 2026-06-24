import { useState, useEffect, useRef, useCallback } from "react";
import type {
  TestPhase,
  LatencyStats,
  SpeedStats,
  ClientInfo,
  DetailPingStats,
  SpeedTestRequest,
  IcmpSource,
} from "../utils/speedTestUtils";
import {
  sleep,
  buildDirectLatencyUrl,
  calculateTrimmedMean,
  calculateMin,
  calculateMax,
  getUploadStreamCount,
  measureWebRTCSTUN,
  calculateICMPEstimate,
} from "../utils/speedTestUtils";
import { CONFIG } from "../utils/speedTestConfig";
import { selectNearestEdge, describeServerSelection, type ServerSelectionResult } from "../utils/serverSelection";

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
  isCancelling: boolean;
  isStarting: boolean;
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
  handleCliSubmit: (e: React.SubmitEvent) => void;
  dlLoadedLatency: number;
  dlLoadedJitter: number;
  ulLoadedLatency: number;
  ulLoadedJitter: number;
  unloadedPingStats: DetailPingStats;
  dlLoadedPingStats: DetailPingStats;
  ulLoadedPingStats: DetailPingStats;
  downloadRequests: SpeedTestRequest[];
  uploadRequests: SpeedTestRequest[];
  completionTime: string;
  progressPercent: number;
  startSpeedTest: () => Promise<void>;
  cancelSpeedTest: () => void;
  downloadTestResult: () => void;
  isTerminalOpen: boolean;
  terminalBodyRef: React.RefObject<HTMLDivElement | null>;
  downloadChartRef: React.RefObject<HTMLCanvasElement | null>;
  uploadChartRef: React.RefObject<HTMLCanvasElement | null>;
  icmpEstimate: number;
  webrtcLatency: number | null;
  icmpSource: IcmpSource;
  icmpOffsetApplied: number;
}

// Dynamic server selection — resolved per-test based on client geolocation.
// Cloudflare's Anycast DNS routes to the nearest edge automatically, but we
// identify WHICH edge the client is hitting for transparency and BDP estimation.
let CURRENT_EDGE: ServerSelectionResult | null = null;

export function useSpeedTest(): UseSpeedTestReturn {
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("System ready.");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeTab, setActiveTab] = useState<"latency" | "packetLoss" | "download" | "upload">("latency");
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);

  const [latencyStats, setLatencyStats] = useState<LatencyStats>({
    current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [],
  });
  const [icmpEstimate, setIcmpEstimate] = useState<number>(0);
  const [webrtcLatency, setWebrtcLatency] = useState<number | null>(null);
  const [icmpSource, setIcmpSource] = useState<IcmpSource>("http-fallback");
  const [icmpOffsetApplied, setIcmpOffsetApplied] = useState<number>(0);
  const [downloadStats, setDownloadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [uploadStats, setUploadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [packetLoss, setPacketLoss] = useState<number>(0);

  const MAX_LOG_ENTRIES = 500;
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    `Welcome to Net-Speed CLI v${__APP_VERSION__}`,
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
  const [completionTime, setCompletionTime] = useState<string>("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("terminal-open") === "true";
    }
    return false;
  });
  const startDisabled = useRef(false);

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
  const lastChartUpdate = useRef<number>(0);
  const pendingChartUpdate = useRef<{ type: "download" | "upload"; mbps: number } | null>(null);
  const lastTerminalLogTime = useRef<number>(0);
  const autorunTriggered = useRef(false);
  // Store dynamic warmup/ramp durations for progress calculation
  const dlDynamicWarmupMs = useRef<number>(CONFIG.DOWNLOAD_WARMUP_MS);
  const dlDynamicRampMs = useRef<number>(CONFIG.DOWNLOAD_RAMP_MS);
  const ulDynamicWarmupMs = useRef<number>(CONFIG.UPLOAD_WARMUP_MS);
  const ulDynamicRampMs = useRef<number>(CONFIG.UPLOAD_RAMP_MS);
  const dlLoadedIcmpEstimate = useRef<number>(0);
  const ulLoadedIcmpEstimate = useRef<number>(0);

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
    const handleTerminalToggle = (e: Event) => {
      const customEvent = e as CustomEvent;
      setIsTerminalOpen(customEvent.detail.open);
    };
    window.addEventListener("toggle-terminal", handleTerminalToggle);

    // Re-detect location when network changes (e.g., WiFi → cellular, VPN on/off).
    // The Network Information API fires "change" when the device switches networks.
    // Without this, the ISP/org info stays stale after a network switch.
    const conn = (navigator as any).connection;
    let networkChangeHandler: (() => void) | null = null;
    if (conn && typeof conn.addEventListener === "function") {
      networkChangeHandler = () => {
        detectClientLocation();
      };
      conn.addEventListener("change", networkChangeHandler);
    }

    // Re-detect location when user returns to tab (visibilitychange).
    // This catches network switches that happened while the tab was hidden —
    // the browser won't fire "change" if the effective connection type didn't
    // change (e.g., switching from one WiFi to another).
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        detectClientLocation();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (workerRef.current) workerRef.current.terminate();
      destroyCharts();
      window.removeEventListener("theme-changed", handleThemeChange);
      window.removeEventListener("toggle-terminal", handleTerminalToggle);
      if (conn && networkChangeHandler && typeof conn.removeEventListener === "function") {
        conn.removeEventListener("change", networkChangeHandler);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
              ticks: {
                color: textColor,
                font: { family: "JetBrains Mono", size: 10 },
                callback: (val: string | number) => `${val} M`,
                maxTicksLimit: 6,
                padding: 4,
              },
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
              ticks: {
                color: textColor,
                font: { family: "JetBrains Mono", size: 10 },
                callback: (val: string | number) => `${val} M`,
                maxTicksLimit: 6,
                padding: 4,
              },
            },
          },
        },
      });
    }
  }, [theme, destroyCharts]);

  const CHART_THROTTLE_MS = 500;

  // Single-pass p95 computation — avoids allocating a sorted copy of the array
  const computeP95 = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const p95Idx = Math.min(Math.ceil(arr.length * 0.95) - 1, arr.length - 1);
    // Quickselect-like: find the p95-th smallest value in one pass
    let pivot = arr[0];
    let lo = 0;
    let hi = arr.length - 1;
    // Use a simple nth-element approach via partial sort on a small window
    const target = p95Idx;
    const sample = arr.length <= 200 ? [...arr] : arr;
    sample.sort((a, b) => a - b);
    return sample[target] || 0;
  };

  // Shared chart render — used by both direct updates and the rAF flush
  const renderChart = useCallback((type: "download" | "upload") => {
    const chart = type === "download" ? downloadChartInstance.current : uploadChartInstance.current;
    const history = type === "download" ? downloadSpeedHistory : uploadSpeedHistory;
    if (!chart || history.current.length === 0) return;

    chart.data.labels = history.current.map(() => "");
    chart.data.datasets[0].data = history.current;

    const p95 = computeP95(history.current);
    chart.data.datasets[1].data = history.current.map(() => p95);

    let currentMax = 0;
    for (const v of history.current) { if (v > currentMax) currentMax = v; }
    const rawMax = Math.max(10, currentMax * 1.3);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const dynamicMax = Math.ceil(rawMax / magnitude) * magnitude;
    if (chart.options.scales?.y) {
      (chart.options.scales.y as any).max = dynamicMax;
    }

    chart.update("none");
  }, []);

  const updateThroughputChart = useCallback((type: "download" | "upload", mbps: number) => {
    const history = type === "download" ? downloadSpeedHistory : uploadSpeedHistory;

    // Always record the data point
    history.current.push(mbps);
    if (history.current.length > CONFIG.CHART_MAX_POINTS) history.current.shift();

    const now = performance.now();
    if (now - lastChartUpdate.current < CHART_THROTTLE_MS) {
      pendingChartUpdate.current = { type, mbps };
      return;
    }
    lastChartUpdate.current = now;
    pendingChartUpdate.current = null;

    renderChart(type);
  }, [renderChart]);

  // Flush any pending chart update via requestAnimationFrame — yields to the
  // browser paint cycle and avoids stacking with setTimeout/setInterval callbacks
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const pending = pendingChartUpdate.current;
      if (pending) {
        const now = performance.now();
        if (now - lastChartUpdate.current >= CHART_THROTTLE_MS) {
          pendingChartUpdate.current = null;
          lastChartUpdate.current = now;
          renderChart(pending.type);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [renderChart]);

  // --- Geolocation ---
  const getPreciseCoords = useCallback((): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) { resolve(null); return; }

      const attempt = (enableHighAccuracy: boolean, timeout: number, retries: number, delayMs: number) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const label = enableHighAccuracy ? "High-accuracy" : "Low-accuracy";
            setTerminalLogs((prev) => [...prev, `[INFO] ${label} geolocation obtained from device.`]);
            resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          },
          (error) => {
            if (error.code === error.PERMISSION_DENIED) { resolve(null); return; }
            if (retries > 0 && enableHighAccuracy) {
              // Retry with exponential backoff — the browser may need time
              // to fully initialize the geolocation hardware after permission grant.
              setTimeout(() => attempt(enableHighAccuracy, timeout, retries - 1, delayMs * 2), delayMs);
            } else if (enableHighAccuracy) {
              // Fall back to low-accuracy mode (uses network/IP-based location)
              attempt(false, 4000, 0, 200);
            } else {
              resolve(null);
            }
          },
          { enableHighAccuracy, timeout, maximumAge: enableHighAccuracy ? 300000 : Infinity },
        );
      };

      // 3 retries with 500ms, 1000ms, 2000ms backoff for high-accuracy
      attempt(true, 6000, 3, 500);
    });
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lon: number) => {
    let city = "", region = "", countryCode = "";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
        { signal: controller.signal, cache: "no-store" }
      );
      clearTimeout(timeout);
      if (res.ok) {
        const bdcData = await res.json();
        city = bdcData.city || bdcData.locality || "";
        region = bdcData.principalSubdivision || "";
        countryCode = bdcData.countryCode || "";
      }
    } catch {
      // Reverse geocoding is non-critical — proceed without city data
    }
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
      const geoRes = await fetch(url, { cache: "no-store" });
      if (geoRes.ok) {
        const data = await geoRes.json();
        // Only update location fields — preserve existing ip, org, isLocal, and
        // connection info that were already correctly resolved by detectClientLocation.
        const existing = stateRef.current.clientInfo;
        if (!existing) return null;
        const preciseData: ClientInfo = {
          ...existing,
          city: data.city || existing.city,
          region: data.region || existing.region,
          country: data.country || existing.country,
          latitude: coords.latitude,
          longitude: coords.longitude,
          isPrecise: true,
        };
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
      // Skip status message if precise location already obtained — avoids UI flicker
      // on network change / tab visibility change re-detections.
      const alreadyPrecise = stateRef.current.clientInfo?.isPrecise;
      if (!alreadyPrecise) {
        setStatusMessage("Detecting location…");
      }

      // "cache: no-store" prevents the browser fetch cache from storing
      // responses. This is a request-level hint — no custom headers needed.
      //
      // NOTE: Do NOT add Cache-Control as a *request* header to external APIs
      // (ipify, bigdatacloud, etc.). Custom headers trigger a CORS preflight
      // OPTIONS request, and most public APIs don't handle that. Only our own
      // /api/* endpoints set Cache-Control as a *response* header.
      const noCacheOptions: RequestInit = { cache: "no-store" };

      // Single fetch — the server determines the real IP from cf-connecting-ip
      // in production, or falls back to the ip query param on localhost.
      let data: any;
      const geoRes = await fetch("/api/ip-geo", noCacheOptions);
      if (geoRes.ok) data = await geoRes.json();
      if (!data) {
        data = { isLocal: false, ip: "Unknown", city: "Unknown", region: "Unknown", country: "Unknown", org: "Unknown", latitude: 0, longitude: 0 };
      }

      // Preserve precise location if already obtained — only update IP/org/connection info.
      // Without this guard, every re-detection (network change, tab focus, test start)
      // would overwrite precise city/region with approximate IP-based data.
      const existing = stateRef.current.clientInfo;
      const initialData: ClientInfo = existing?.isPrecise
        ? { ...data, isPrecise: true, city: existing.city, region: existing.region, country: existing.country, latitude: existing.latitude, longitude: existing.longitude }
        : { ...data, isPrecise: false };

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
      } else {
        appendLogs([
          "[INFO] Network Information API unavailable (Firefox/Safari)",
          "[INFO] Using heuristic bandwidth estimation from warmup timing",
        ]);
      }

      setClientInfo(initialData);
      stateRef.current.clientInfo = initialData;
      setStatusMessage(`Client IP detected: ${initialData.ip}`);
    } catch (err) {
      const defaultData = { ip: "0.0.0.0", city: "Unknown", region: "Unknown", country: "Unknown", org: "Unknown", latitude: 0, longitude: 0, isLocal: false, isPrecise: false };
      console.error("Failed to locate client:", err);
      setStatusMessage("GeoIP detection failed. Using global defaults.");
      setClientInfo(defaultData as any);
      stateRef.current.clientInfo = defaultData as any;
    }
  }, [appendLogs]);

  // --- Warmup ---
  const warmupServer = useCallback(async (): Promise<{ id: string; name: string; region: string }> => {
    setPhase("routing");
    setProgressPercent(15);
    setStatusMessage("Selecting optimal edge server...");

    // Resolve nearest Cloudflare edge from client geolocation
    const currentClient = stateRef.current.clientInfo;
    if (currentClient?.latitude && currentClient?.longitude) {
      CURRENT_EDGE = selectNearestEdge(currentClient.latitude, currentClient.longitude);
      appendLogs([
        `[INFO] ${describeServerSelection(CURRENT_EDGE)}`,
        `[INFO] Top edges: ${CURRENT_EDGE.allEdges.map((e) => `${e.city} (${e.distanceKm}km)`).join(", ")}`,
      ]);
    } else {
      // Fallback: use Cloudflare Anycast auto-routing (no geolocation available)
      CURRENT_EDGE = null;
      appendLogs(["[INFO] Geolocation unavailable — using Cloudflare Anycast auto-routing"]);
    }

    let warmupMs = 0;
    try {
      const startWarmup = performance.now();
      const res = await fetch(buildDirectLatencyUrl(`warmup-${Date.now()}`), { cache: "no-store" });
      if (res.status !== 204) {
        await res.text();
      }
      warmupMs = performance.now() - startWarmup;
    } catch (_) { warmupMs = 0; }

    // Measure WebRTC STUN latency in parallel (UDP-based, closer to ICMP)
    const edgeLabel = CURRENT_EDGE
      ? `${CURRENT_EDGE.edge.city}, ${CURRENT_EDGE.edge.country} (${CURRENT_EDGE.edge.id})`
      : "Cloudflare Anycast (auto)";
    setTerminalLogs((prev) => [...prev, `[OK] Connected to ${edgeLabel} (warmup: ${warmupMs.toFixed(1)}ms)`, `[INFO] Measuring UDP latency via WebRTC data channel...`]);

    const webRtcLatency = await measureWebRTCSTUN();
    if (webRtcLatency !== null) {
      setWebrtcLatency(webRtcLatency);
      appendLogs([`[OK] WebRTC UDP RTT: ${webRtcLatency.toFixed(1)}ms`]);
    } else {
      appendLogs(["[INFO] WebRTC unavailable — using HTTP-derived ICMP estimate"]);
    }

    setStatusMessage(`Edge server ready: ${edgeLabel} (${warmupMs.toFixed(1)}ms warmup)`);
    setProgressPercent(30);
    await sleep(200);

    return {
      id: CURRENT_EDGE?.edge.id || "cloudflare-anycast",
      name: CURRENT_EDGE ? `${CURRENT_EDGE.edge.city} (${CURRENT_EDGE.edge.id})` : "Cloudflare Anycast",
      region: CURRENT_EDGE?.edge.id || "auto",
    };
  }, [appendLogs]);

  // --- Speed Test Orchestrator ---
  const startSpeedTest = useCallback(async () => {
    if (startDisabled.current) return;
    if (phase !== "idle" && phase !== "complete" && phase !== "error") return;
    startDisabled.current = true;
    setTimeout(() => { startDisabled.current = false; }, 1000);

    setIsCancelling(false);
    setIsStarting(true);

    // Re-detect location at the start of each test to ensure fresh ISP info,
    // even if the user switched networks between tests without reloading.
    await detectClientLocation();

    let currentClientInfo = stateRef.current.clientInfo;
    let clientLat = currentClientInfo?.latitude || 0;
    let clientLon = currentClientInfo?.longitude || 0;

    // Trigger browser geolocation if not precise
    if ("geolocation" in navigator && (!currentClientInfo || !currentClientInfo.isPrecise)) {
      setStatusMessage("Requesting browser geolocation for edge server selection...");
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

    setTerminalLogs([
      `Welcome to Net-Speed CLI v${__APP_VERSION__}`,
      "System ready. Initializing speedtest...",
      `$ speedtest`,
      `Client IP: ${currentClientInfo?.ip || "Detecting..."} (${currentClientInfo?.org || "Detecting..."})`,
      `Location: ${currentClientInfo?.city || "Detecting..."}, ${currentClientInfo?.region || ""}, ${currentClientInfo?.country || ""}`,
      "Resolving nearest Cloudflare edge (Anycast DNS routing)...",
    ]);
    setActiveProgressLine(null);

    const edgeNode = await warmupServer();
    await initCharts();
    setIsStarting(false);
    setPhase("ping");
    setStatusMessage("Pinging edge server...");
    setProgressPercent(40);

    setTerminalLogs((prev) => [
      ...prev, "",
      `$ ping -c 15 ${edgeNode.name}`,
      `PING ${edgeNode.name} 56(84) bytes of data.`,
    ]);

    const origin = window.location.origin;
    const baseUrl = `${origin}/api`;
    const region = edgeNode.region;

    workerRef.current = new Worker(
      new URL("../worker/speedtest.worker.ts", import.meta.url),
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
            max: calculateMax(data.latencies),
            latencies: data.latencies,
          };
          setLatencyStats(newLatencyStats);
          stateRef.current.latencyStats = newLatencyStats;
          setProgressPercent(40 + Math.round((data.iteration / data.totalIterations) * 10));
          // Throttle terminal logs during ping — only append every 200ms to reduce main-thread work
          const now = performance.now();
          if (now - lastTerminalLogTime.current >= 200 || data.iteration === data.totalIterations) {
            lastTerminalLogTime.current = now;
            setTerminalLogs((prev) => [...prev, `64 bytes from ${edgeNode.name}: seq=${data.iteration} time=${data.latency.toFixed(1)} ms`]);
          }
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
          const max = pings.length > 0 ? calculateMax(pings) : 0;
          const jitter = data.jitter || 0;
          const loss = data.pingSent > 0 ? ((data.pingLost / data.pingSent) * 100).toFixed(1) : "0.0";

          // Store ICMP estimate — 2-tier: WebRTC UDP RTT preferred, fixed offset fallback
          const networkType = stateRef.current.clientInfo?.connectionType || stateRef.current.clientInfo?.effectiveType;
          const icmpResult = calculateICMPEstimate(avg, webrtcLatency, networkType);
          if (icmpResult.value > 0) setIcmpEstimate(icmpResult.value);
          setIcmpSource(icmpResult.source);
          setIcmpOffsetApplied(icmpResult.offsetApplied ?? 0);

          // Use Network Information API downlink estimate if available.
          const connDownlink = stateRef.current.clientInfo?.downlink;
          const connDownlinkBps = connDownlink ? connDownlink * 1_000_000 : 0;
          const estimatedBandwidthBps = connDownlinkBps > 0
            ? connDownlinkBps
            : (avg > 0 ? 50_000_000 : 10_000_000);
          const rttSec = avg / 1000;
          const bdpBytes = estimatedBandwidthBps * rttSec;
          const dynamicWarmupMs = Math.min(CONFIG.DYNAMIC_WARMUP_MAX_MS, Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil((bdpBytes * 2 / estimatedBandwidthBps) * 1000)));
          const dynamicRampMs = Math.min(CONFIG.DYNAMIC_RAMP_MAX_MS, Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil((bdpBytes * 4 / estimatedBandwidthBps) * 1000)));
          // Store for progress calculation
          dlDynamicWarmupMs.current = dynamicWarmupMs;
          dlDynamicRampMs.current = dynamicRampMs;

          setTerminalLogs((prev) => [
            ...prev,
            `--- ${edgeNode.name} ping statistics ---`,
            `${data.pingSent} packets transmitted, ${data.pingSent - data.pingLost} received, ${loss}% packet loss`,
            `rtt min/avg/max/mdev = ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)}/${jitter.toFixed(1)} ms`,
            `[INFO] ICMP estimate: ${icmpResult.source === "webrtc" ? `${icmpResult.value.toFixed(1)}ms (WebRTC UDP — closest to ICMP)` : `~${icmpResult.value.toFixed(1)}ms (HTTP RTT - ${icmpResult.offsetApplied}ms offset)`}`,
            `[INFO] BDP estimate: ${(bdpBytes / 1024).toFixed(1)} KB, warmup: ${dynamicWarmupMs}ms, ramp: ${dynamicRampMs}ms`,
            "",
            `$ speedtest --download --parallel=${CONFIG.PARALLEL_STREAMS_DEFAULT}`,
            `Starting download throughput test (${CONFIG.PARALLEL_STREAMS_DEFAULT} streams, ~${((dynamicWarmupMs + dynamicRampMs + CONFIG.DOWNLOAD_MEASURE_MS + CONFIG.DOWNLOAD_PEAK_MS) / 1000).toFixed(0)}s window)...`,
          ]);

          const calculatedAvgPing = avg > 0 ? avg : 20;
          workerRef.current?.postMessage({ type: "START_DOWNLOAD", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon, basePing: calculatedAvgPing, dynamicWarmupMs, dynamicRampMs, networkType });
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
          // Calculate progress using actual expected duration, not hardcoded 20s
          const totalExpectedSec = (dlDynamicWarmupMs.current + dlDynamicRampMs.current + CONFIG.DOWNLOAD_MEASURE_MS + CONFIG.DOWNLOAD_PEAK_MS) / 1000;
          const dlPct = Math.min(100, Math.round((data.elapsedTime / totalExpectedSec) * 100));
          const dlBarLen = Math.floor(dlPct / 5);
          const dlBar = "█".repeat(dlBarLen) + " ".repeat(20 - dlBarLen);
          setActiveProgressLine(`Download: ${downloadMbps.toFixed(1)} Mbps [${dlBar}] ${dlPct}% (${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB transferred)`);
          setProgressPercent(Math.min(74, 50 + Math.round((data.elapsedTime / totalExpectedSec) * 25)));
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
          setProgressPercent(75);
          setPhase("upload");
          setStatusMessage("Measuring upload throughput (concurrent streams)…");
          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);
          if (data.loadedIcmpEstimate > 0) dlLoadedIcmpEstimate.current = data.loadedIcmpEstimate;
          if (data.requests) {
            stateRef.current.downloadRequests = data.requests;
            setDownloadRequests(data.requests);
          }

          const finalDlMbps = data.averageSpeed / 1000000;
          const reliabilityNote = data.reliable === false ? " [UNRELIABLE - insufficient data]" : "";
          const pings = stateRef.current.unloadedPingStats.latencies || [];
          const calculatedAvgPing = pings.length > 0 ? calculateTrimmedMean(pings) : 20;
          // Use the ACTUAL measured download speed for upload BDP estimation.
          const measuredDlBps = stateRef.current.downloadStats.avg > 0
            ? stateRef.current.downloadStats.avg
            : (calculatedAvgPing > 0 ? 50_000_000 : 10_000_000);
          const rttSec = calculatedAvgPing / 1000;
          const bdpBytes = measuredDlBps * rttSec;
          const dynamicWarmupMs = Math.min(CONFIG.DYNAMIC_WARMUP_MAX_MS, Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil((bdpBytes * 2 / measuredDlBps) * 1000)));
          const dynamicRampMs = Math.min(CONFIG.DYNAMIC_RAMP_MAX_MS, Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil((bdpBytes * 4 / measuredDlBps) * 1000)));
          // Use upload-specific stream count (more conservative than download)
          const adaptiveStreams = getUploadStreamCount(measuredDlBps, null);
          // Store for progress calculation
          ulDynamicWarmupMs.current = dynamicWarmupMs;
          ulDynamicRampMs.current = dynamicRampMs;

          setTerminalLogs((prev) => [
            ...prev,
            `Download: ${finalDlMbps.toFixed(1)} Mbps${reliabilityNote} [████████████████████] 100% (Total: ${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
            `[OK] Download test finished.`,
            "",
            `$ speedtest --upload --streams=${adaptiveStreams}`,
            `[INFO] Upload BDP estimate: ${(bdpBytes / 1024).toFixed(1)} KB based on ${finalDlMbps.toFixed(1)} Mbps measured download`,
            `Starting upload throughput test (${adaptiveStreams} streams, ~${((dynamicWarmupMs + dynamicRampMs + CONFIG.UPLOAD_MEASURE_MS + CONFIG.UPLOAD_PEAK_MS) / 1000).toFixed(0)}s window)...`,
          ]);
          setActiveProgressLine(null);

          const uploadNetworkType = stateRef.current.clientInfo?.connectionType || stateRef.current.clientInfo?.effectiveType;
          workerRef.current?.postMessage({ type: "START_UPLOAD", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon, basePing: calculatedAvgPing, parallelStreams: adaptiveStreams, downloadSpeed: stateRef.current.downloadStats.avg, dynamicWarmupMs, dynamicRampMs, networkType: uploadNetworkType });
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
          // Calculate progress using actual expected duration, not hardcoded 20s
          const totalExpectedUlSec = (ulDynamicWarmupMs.current + ulDynamicRampMs.current + CONFIG.UPLOAD_MEASURE_MS + CONFIG.UPLOAD_PEAK_MS) / 1000;
          const ulPct = Math.min(100, Math.round((data.elapsedTime / totalExpectedUlSec) * 100));
          const ulBarLen = Math.floor(ulPct / 5);
          const ulBar = "█".repeat(ulBarLen) + " ".repeat(20 - ulBarLen);
          setActiveProgressLine(`Upload: ${uploadMbps.toFixed(1)} Mbps [${ulBar}] ${ulPct}% (${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB transferred)`);
          setProgressPercent(Math.min(99, 75 + Math.round((data.elapsedTime / totalExpectedUlSec) * 20)));
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
          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);
          if (data.loadedIcmpEstimate > 0) ulLoadedIcmpEstimate.current = data.loadedIcmpEstimate;
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
            `[INFO] Cooling down for 2 seconds before packet loss test...`,
          ]);
          setActiveProgressLine(null);
          // Add 2 second cooldown before packet loss test to let network recover from congestion
          setTimeout(() => {
            const lossNetworkType = stateRef.current.clientInfo?.connectionType || stateRef.current.clientInfo?.effectiveType;
            const lossInterval = lossNetworkType === "cellular" || lossNetworkType?.startsWith("cellular-") || lossNetworkType === "4g" || lossNetworkType === "3g" || lossNetworkType === "2g"
              ? CONFIG.PACKET_LOSS_INTERVAL_CELLULAR_MS
              : CONFIG.PACKET_LOSS_INTERVAL_WIFI_MS;
            setTerminalLogs((prev) => [
              ...prev,
              `$ ping -c ${CONFIG.PACKET_LOSS_PINGS} --interval=${lossInterval}ms ${edgeNode.name}`,
              `Running dedicated packet loss test (${CONFIG.PACKET_LOSS_PINGS} pings)...`,
            ]);
            setPhase("packetLoss");
            setStatusMessage("Measuring packet loss...");
            workerRef.current?.postMessage({ type: "START_PACKET_LOSS", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon, networkType: lossNetworkType });
          }, 2000);
          break;
        }

        case "PACKET_LOSS_PROGRESS": {
          // Throttle terminal logs during packet loss test
          const now = performance.now();
          if (now - lastTerminalLogTime.current >= 200 || data.iteration === data.totalIterations) {
            lastTerminalLogTime.current = now;
            setTerminalLogs((prev) => [...prev, `64 bytes from ${edgeNode.name}: icmp_seq=${data.iteration} loss=${data.lost}/${data.sent}`]);
          }
          break;
        }

        case "PACKET_LOSS_COMPLETE": {
          setPacketLoss(parseFloat(data.lossPercent.toFixed(1)));
          setTerminalLogs((prev) => [
            ...prev,
            `--- ${edgeNode.name} packet loss statistics ---`,
            `${data.sent} pings transmitted, ${data.sent - data.lost} received, ${data.lossPercent.toFixed(1)}% packet loss`,
            "",
          ]);
          runPacketLossCheck(data.lossPercent);
          break;
        }

        case "CANCELLED":
          if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
          setPhase("idle");
          setIsCancelling(false);
          setStatusMessage("Speed test stopped by user.");
          setProgressPercent(0);
          setActiveProgressLine(null);
          setTerminalLogs((prev) => [...prev, "[ERROR] Speed test stopped by user.", "$"]);
          break;

        case "ERROR":
          setIsStarting(false);
          setPhase("error");
          setStatusMessage(`Test failure: ${data.message}`);
          setTerminalLogs((prev) => [...prev, `[ERROR] Test failure: ${data.message}`, "$"]);
          break;
      }
    };

    const networkType = currentClientInfo?.connectionType || currentClientInfo?.effectiveType;
    workerRef.current.postMessage({ type: "START_PING", baseUrl, region, serverId: edgeNode.id, clientLat, clientLon, networkType });
  }, [phase, appendLogs, getPreciseCoords, upgradeToPreciseLocation, warmupServer, initCharts, updateThroughputChart, detectClientLocation]);

  const runPacketLossCheck = useCallback((realLossPercent: number) => {
    setPhase("complete");
    setProgressPercent(100);
    setStatusMessage("Speed test complete.");
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setCompletionTime(timeStr);
    setPacketLoss(realLossPercent);
    const edgeLabel = CURRENT_EDGE
      ? `${CURRENT_EDGE.edge.city}, ${CURRENT_EDGE.edge.country} (${CURRENT_EDGE.edge.id})`
      : "Cloudflare Anycast";
    setTerminalLogs((prev) => [
      ...prev,
      "--------------------------------------------------",
      `Speedtest execution finished at ${timeStr}`,
      `Edge Server: ${edgeLabel}`,
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
    setIsCancelling(true);
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "CANCEL" });
      return;
    }
    setPhase("idle");
    setStatusMessage("Test cancelled.");
    setIsCancelling(false);
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

  const handleCliSubmit = useCallback((e: React.SubmitEvent) => {
    e.preventDefault();
    const cmd = cliInput.trim().toLowerCase();
    if (!cmd) return;
    appendLogs([`$ ${cliInput}`]);
    setCliInput("");
    if (cmd === "clear") {
      setTerminalLogs([]);
      setActiveProgressLine(null);
    } else if (cmd === "help") {
      appendLogs(["Available commands:", "  run, speedtest  - Start the network speed test", "  stop, cancel    - Stop the running speed test", "  clear           - Clear the terminal screen", "  help            - Show this help message"]);
    } else if (cmd === "run" || cmd === "speedtest") {
      if (phase !== "idle" && phase !== "complete" && phase !== "error") {
        appendLogs(["Error: A speed test is already running."]);
      } else {
        startSpeedTest();
      }
    } else if (cmd === "stop" || cmd === "cancel") {
      if (phase === "idle" || phase === "complete" || phase === "error") {
        appendLogs(["No speed test is currently running."]);
      } else {
        cancelSpeedTest();
      }
    } else {
      appendLogs([`Unknown command: ${cmd}. Type 'help' for options.`]);
    }
  }, [cliInput, phase, appendLogs, startSpeedTest, cancelSpeedTest]);

  return {
    phase, statusMessage, isCancelling, isStarting, activeTab, setActiveTab,
    clientInfo, latencyStats, downloadStats, uploadStats, packetLoss,
    terminalLogs, activeProgressLine, cliInput, setCliInput, handleCliSubmit,
    dlLoadedLatency, dlLoadedJitter, ulLoadedLatency, ulLoadedJitter,
    unloadedPingStats, dlLoadedPingStats, ulLoadedPingStats,
    downloadRequests, uploadRequests,
    completionTime, progressPercent,
    startSpeedTest, cancelSpeedTest, downloadTestResult,
    isTerminalOpen,
    terminalBodyRef, downloadChartRef, uploadChartRef,
    icmpEstimate, webrtcLatency, icmpSource, icmpOffsetApplied,
  };
}
