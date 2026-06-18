import { useState, useEffect, useRef } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Download,
  Wifi,
  AlertTriangle,
  Play,
  Square,
} from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Tooltip,
  Legend,
);

// Import sub-components
import InfoTooltip from "./SpeedTest/InfoTooltip";
import QualityScores from "./SpeedTest/QualityScores";
import DetailedMeasurements from "./SpeedTest/DetailedMeasurements";
import TechnicalLogs from "./SpeedTest/TechnicalLogs";

// Import utilities, types and configuration
import type {
  TestPhase,
  LatencyStats,
  SpeedStats,
  ClientInfo,
  DetailPingStats,
  SpeedTestRequest,
} from "../utils/speedTestUtils";
import {
  sleep,
  formatSpeed,
  isLocalHost,
  calculateTrimmedMean,
  calculateMin,
  getAdaptiveStreamCount,
} from "../utils/speedTestUtils";
import { CONFIG } from "../utils/speedTestConfig";

export default function SpeedTest() {
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("System ready.");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeTab, setActiveTab] = useState<
    "latency" | "packetLoss" | "download" | "upload"
  >("latency");

  // Geolocation State
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);

  // Edge node info (Cloudflare handles routing via Anycast BGP)
  const EDGE_NODE = { id: "cloudflare-edge", name: "Cloudflare Edge (nearest)", region: "auto" };

  // Test Metrics
  const [latencyStats, setLatencyStats] = useState<LatencyStats>({
    current: 0,
    avg: 0,
    jitter: 0,
    min: Infinity,
    max: 0,
    latencies: [],
  });
  const [downloadStats, setDownloadStats] = useState<SpeedStats>({
    current: 0,
    avg: 0,
    peak: 0,
  });
  const [uploadStats, setUploadStats] = useState<SpeedStats>({
    current: 0,
    avg: 0,
    peak: 0,
  });
  const [packetLoss, setPacketLoss] = useState<number>(0);

  // Terminal simulation state
  const MAX_LOG_ENTRIES = 500;
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "Welcome to Net-Speed CLI v0.1.1",
    "System ready. Click 'Start Speed Test' or type 'run' in terminal.",
  ]);
  const appendLogs = (newLogs: string[]) => {
    setTerminalLogs((prev) => {
      const combined = [...prev, ...newLogs];
      return combined.length > MAX_LOG_ENTRIES ? combined.slice(-MAX_LOG_ENTRIES) : combined;
    });
  };
  const [activeProgressLine, setActiveProgressLine] = useState<string | null>(null);
  const [cliInput, setCliInput] = useState("");
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

  // Refs to track live values avoiding stale closures in Web Worker callbacks
  const downloadStatsRef = useRef<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const uploadStatsRef = useRef<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const latencyStatsRef = useRef<LatencyStats>({
    current: 0,
    avg: 0,
    jitter: 0,
    min: Infinity,
    max: 0,
    latencies: [],
  });

  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [terminalLogs, activeProgressLine]);

  const handleCliSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = cliInput.trim().toLowerCase();
    if (!cmd) return;

    appendLogs([`$ ${cliInput}`]);
    setCliInput("");

    if (cmd === "clear") {
      setTerminalLogs([]);
      setActiveProgressLine(null);
    } else if (cmd === "help") {
      appendLogs([
        "Available commands:",
        "  run, speedtest  - Start the network speed test",
        "  clear           - Clear the terminal screen",
        "  help            - Show this help message",
      ]);
    } else if (cmd === "run" || cmd === "speedtest") {
      if (phase !== "idle" && phase !== "complete" && phase !== "error") {
        appendLogs(["Error: A speed test is already running."]);
      } else {
        startSpeedTest();
      }
    } else {
      appendLogs([`Unknown command: ${cmd}. Type 'help' for options.`]);
    }
  };

  // Loaded latency and jitter stats (split download vs upload phase pings)
  const [dlLoadedLatency, setDlLoadedLatency] = useState<number>(0);
  const [dlLoadedJitter, setDlLoadedJitter] = useState<number>(0);
  const [ulLoadedLatency, setUlLoadedLatency] = useState<number>(0);
  const [ulLoadedJitter, setUlLoadedJitter] = useState<number>(0);

  // Detailed Cloudflare-style stats states
  const [unloadedPingStats, setUnloadedPingStats] = useState<DetailPingStats>({
    sent: 0,
    lost: 0,
    latencies: [],
  });
  const [dlLoadedPingStats, setDlLoadedPingStats] = useState<DetailPingStats>({
    sent: 0,
    lost: 0,
    latencies: [],
  });
  const [ulLoadedPingStats, setUlLoadedPingStats] = useState<DetailPingStats>({
    sent: 0,
    lost: 0,
    latencies: [],
  });
  const [downloadRequests, setDownloadRequests] = useState<SpeedTestRequest[]>([]);
  const [uploadRequests, setUploadRequests] = useState<SpeedTestRequest[]>([]);

  // Measurement reliability flags
  const [downloadReliable, setDownloadReliable] = useState(true);
  const [uploadReliable, setUploadReliable] = useState(true);

  // Completion Time
  const [completionTime, setCompletionTime] = useState<string>("");

  // Progress tracker variables
  const [progressPercent, setProgressPercent] = useState(0);

  // References
  const workerRef = useRef<Worker | null>(null);
  const downloadChartRef = useRef<HTMLCanvasElement | null>(null);
  const uploadChartRef = useRef<HTMLCanvasElement | null>(null);
  const downloadChartInstance = useRef<ChartJS | null>(null);
  const uploadChartInstance = useRef<ChartJS | null>(null);

  // Speed data arrays for charting
  const downloadSpeedHistory = useRef<number[]>([]);
  const uploadSpeedHistory = useRef<number[]>([]);

  // Detailed stats references to avoid stale closure variables in Web Worker messages
  const unloadedPingStatsRef = useRef<DetailPingStats>({
    sent: 0,
    lost: 0,
    latencies: [],
  });
  const dlLoadedPingStatsRef = useRef<DetailPingStats>({
    sent: 0,
    lost: 0,
    latencies: [],
  });
  const ulLoadedPingStatsRef = useRef<DetailPingStats>({
    sent: 0,
    lost: 0,
    latencies: [],
  });

  // Request logs for Cloudflare CSV export
  const downloadRequestsRef = useRef<SpeedTestRequest[]>([]);
  const uploadRequestsRef = useRef<SpeedTestRequest[]>([]);
  const autorunTriggered = useRef(false);

  // 1. Initialize client details on load and check theme state
  useEffect(() => {
    detectClientLocation();

    // Initial theme set based on document.documentElement class
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setTheme(customEvent.detail.theme);
    };

    window.addEventListener("theme-changed", handleThemeChange);

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      destroyCharts();
      window.removeEventListener("theme-changed", handleThemeChange);
    };
  }, []);

  // Handle automatic speed test execution via URL parameter
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (
      searchParams.get("autorun") === "true" &&
      !autorunTriggered.current &&
      clientInfo !== null
    ) {
      autorunTriggered.current = true;

      // Clean query parameter from URL so page reload doesn't auto-run again
      const url = new URL(window.location.href);
      url.searchParams.delete("autorun");
      window.history.replaceState(
        {},
        document.title,
        url.pathname + url.search,
      );

      startSpeedTest();
    }
  }, [clientInfo]);

  // Sync Chart.js scale colors with light/dark theme switch
  useEffect(() => {
    const gridColor = theme === "dark" ? "#222222" : "#ebebeb";
    const textColor = theme === "dark" ? "#a1a1a1" : "#888888";

    if (downloadChartInstance.current) {
      const opts = downloadChartInstance.current.options as any;
      if (opts.scales?.y) {
        opts.scales.y.grid.color = gridColor;
        opts.scales.y.ticks.color = textColor;
      }
      downloadChartInstance.current.update("none");
    }
    if (uploadChartInstance.current) {
      const opts = uploadChartInstance.current.options as any;
      if (opts.scales?.y) {
        opts.scales.y.grid.color = gridColor;
        opts.scales.y.ticks.color = textColor;
      }
      uploadChartInstance.current.update("none");
    }
  }, [theme]);

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

    const gridColor = theme === "dark" ? "#222222" : "#ebebeb";
    const textColor = theme === "dark" ? "#a1a1a1" : "#888888";

    // Download Chart Initializer
    if (downloadChartRef.current) {
      downloadChartInstance.current = new ChartJS(downloadChartRef.current, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Download Speed",
              data: [],
              borderColor: "#eb6f20", // Orange style
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
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: "JetBrains Mono", size: 10 },
                callback: (val) => `${val} M`,
              },
            },
          },
        },
      });
    }

    // Upload Chart Initializer
    if (uploadChartRef.current) {
      uploadChartInstance.current = new ChartJS(uploadChartRef.current, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Upload Speed",
              data: [],
              borderColor: "#8b5cf6", // Purple style
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
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: "JetBrains Mono", size: 10 },
                callback: (val) => `${val} M`,
              },
            },
          },
        },
      });
    }
  };

  const updateThroughputChart = (type: "download" | "upload", mbps: number) => {
    if (type === "download") {
      const chart = downloadChartInstance.current;
      if (!chart) return;

      downloadSpeedHistory.current.push(mbps);
      if (downloadSpeedHistory.current.length > CONFIG.CHART_MAX_POINTS) {
        downloadSpeedHistory.current.shift();
      }
      chart.data.labels = downloadSpeedHistory.current.map(() => "");
      chart.data.datasets[0].data = downloadSpeedHistory.current;

      const sorted = [...downloadSpeedHistory.current].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
      chart.data.datasets[1].data = downloadSpeedHistory.current.map(() => p90);

      chart.update("none");
    } else {
      const chart = uploadChartInstance.current;
      if (!chart) return;

      uploadSpeedHistory.current.push(mbps);
      if (uploadSpeedHistory.current.length > CONFIG.CHART_MAX_POINTS) {
        uploadSpeedHistory.current.shift();
      }
      chart.data.labels = uploadSpeedHistory.current.map(() => "");
      chart.data.datasets[0].data = uploadSpeedHistory.current;

      const sorted = [...uploadSpeedHistory.current].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
      chart.data.datasets[1].data = uploadSpeedHistory.current.map(() => p90);

      chart.update("none");
    }
  };


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const initializeLocationData = (_data: any) => {
    // No-op: Cloudflare Anycast BGP handles edge routing automatically.
  };

  const getPreciseCoords = (): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }

      // Try highly accurate precise location (GPS-level) first with a 6-second timeout and 5-minute cache.
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setTerminalLogs((prev) => [...prev, "[INFO] High-accuracy geolocation obtained from device."]);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            console.warn("Geolocation permission denied by user.");
            resolve(null);
            return;
          }

          console.warn(`High-accuracy Geolocation failed (Code: ${error.code}, Message: ${error.message}). Trying low-accuracy fallback...`);

          // Try low-accuracy fallback (Wi-Fi/cell) with a 4-second timeout and allowing cached positions of any age
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setTerminalLogs((prev) => [...prev, "[INFO] Low-accuracy geolocation obtained from device."]);
              resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
            },
            (err) => {
              console.warn(`Low-accuracy Geolocation also failed (Code: ${err.code}, Message: ${err.message}).`);
              resolve(null);
            },
            {
              enableHighAccuracy: false,
              timeout: 4000,
              maximumAge: Infinity,
            }
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 6000,
          maximumAge: 300000,
        }
      );
    });
  };

  // 3. Detect client geolocation from server & browser Geolocation API
  const detectClientLocation = async () => {
    try {
      // Check if geolocation permission is already granted
      let preGrantedCoords: { latitude: number; longitude: number } | null = null;
      if ("geolocation" in navigator && navigator.permissions) {
        try {
          const perm = await navigator.permissions.query({ name: "geolocation" });
          if (perm.state === "granted") {
            preGrantedCoords = await getPreciseCoords();
          }
        } catch (e) {
          console.warn("Permissions API query failed:", e);
        }
      }

      // 1. Fetch IP-based geolocation immediately, passing precise coords if pre-granted
      setStatusMessage("Detecting location…");
      let url = "/api/ip-geo";
      if (preGrantedCoords) {
        let city = "";
        let region = "";
        let countryCode = "";
        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${preGrantedCoords.latitude}&longitude=${preGrantedCoords.longitude}&localityLanguage=en`
          );
          if (res.ok) {
            const bdcData = await res.json();
            city = bdcData.city || bdcData.locality || "";
            region = bdcData.principalSubdivision || "";
            countryCode = bdcData.countryCode || "";
          }
        } catch (e) {
          console.warn("Client-side reverse geocoding failed on load:", e);
        }

        url = `/api/ip-geo?clientLat=${preGrantedCoords.latitude}&clientLon=${preGrantedCoords.longitude}`;
        if (city) url += `&city=${encodeURIComponent(city)}`;
        if (region) url += `&region=${encodeURIComponent(region)}`;
        if (countryCode) url += `&countryCode=${encodeURIComponent(countryCode)}`;
      }
      const geoRes = await fetch(url);
      let data = await geoRes.json();

      // If loopback IP detected (localhost development), fetch client's public IP to resolve location
      if (data.isLocal && !preGrantedCoords) {
        try {
          const ipRes = await fetch("https://api.ipify.org?format=json");
          if (ipRes.ok) {
            const ipData = await ipRes.json();
            if (ipData && ipData.ip) {
              const upgradeRes = await fetch(`/api/ip-geo?ip=${ipData.ip}`);
              if (upgradeRes.ok) {
                data = await upgradeRes.json();
              }
            }
          }
        } catch (e) {
          console.warn("Client-side public IP lookup failed, using loopback default:", e);
        }
      }

      // Initialize UI with the geocoded data
      const initialData: ClientInfo = {
        ...data,
        isPrecise: !!preGrantedCoords,
      };

      // Detect connection type via Network Information API (Fix #12)
      if ("connection" in navigator) {
        const conn = (navigator as any).connection;
        if (conn) {
          initialData.effectiveType = conn.effectiveType || undefined;
          initialData.downlink = conn.downlink || undefined;
          initialData.rtt = conn.rtt || undefined;

          // Determine connection type from effectiveType or type property
          if (conn.type) {
            initialData.connectionType = conn.type; // "wifi", "ethernet", "cellular", etc.
          } else if (conn.effectiveType) {
            // Map effectiveType to a general category
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
      initializeLocationData(initialData);
      setStatusMessage(
        preGrantedCoords
          ? `Precise location loaded: ${initialData.city}, ${initialData.country}`
          : `Client IP detected: ${initialData.ip}`
      );
    } catch (err) {
      const defaultData = {
        ip: "0.0.0.0",
        city: "Unknown",
        region: "Unknown",
        country: "Unknown",
        org: "Unknown",
        latitude: 0,
        longitude: 0,
        isLocal: false,
        isPrecise: false,
      };
      console.error("Failed to locate client:", err);
      setStatusMessage("GeoIP detection failed. Using global defaults.");
      setClientInfo(defaultData as any);
      initializeLocationData(defaultData);
    }
  };

  // 5. Warmup: single ping to establish TCP/TLS keep-alive with Cloudflare edge.
  // Cloudflare Anycast BGP handles optimal edge routing automatically.
  const warmupEdge = async (): Promise<{ id: string; name: string; region: string }> => {
    setPhase("routing");
    setProgressPercent(15);
    setStatusMessage("Warming up connection to Cloudflare edge…");

    const origin = window.location.origin;

    // Single warmup ping — establishes TCP/TLS connection, measures baseline latency
    let hostLatency = 0;
    try {
      const warmupUrl = `${origin}/api/ping?warmup=true&cb=${Date.now()}`;
      const startWarmup = performance.now();
      const res = await fetch(warmupUrl, { cache: "no-store" });
      await res.text();
      hostLatency = performance.now() - startWarmup;
    } catch (_) {
      hostLatency = 0;
    }

    const isLocalConnection = isLocalHost(window.location.hostname);
    if (isLocalConnection) {
      hostLatency = Math.max(1.5, hostLatency);
    }

    setTerminalLogs((prev) => [
      ...prev,
      `[OK] Connected to Cloudflare edge (warmup: ${hostLatency.toFixed(1)}ms)`,
    ]);

    setStatusMessage(`Cloudflare edge ready (${hostLatency.toFixed(1)}ms warmup)`);
    setProgressPercent(30);
    await sleep(200);
    return EDGE_NODE;
  };

  // 6. Primary Speed Test Orchestrator
  const startSpeedTest = async () => {
    if (phase !== "idle" && phase !== "complete" && phase !== "error") return;

    let currentClientInfo = clientInfo;
    let clientLat = clientInfo?.latitude || 0;
    let clientLon = clientInfo?.longitude || 0;

    // Trigger browser geolocation prompt on user action if not already precise
    if ("geolocation" in navigator && (!clientInfo || !clientInfo.isPrecise)) {
      setStatusMessage("Requesting browser geolocation for optimal server routing...");
      appendLogs(["[INFO] Requesting browser geolocation for high accuracy routing..."]);
      const coords = await getPreciseCoords();
      if (coords) {
        try {
          let city = "";
          let region = "";
          let countryCode = "";
          try {
            const res = await fetch(
              `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.latitude}&longitude=${coords.longitude}&localityLanguage=en`
            );
            if (res.ok) {
              const bdcData = await res.json();
              city = bdcData.city || bdcData.locality || "";
              region = bdcData.principalSubdivision || "";
              countryCode = bdcData.countryCode || "";
            }
          } catch (e) {
            console.warn("Client-side reverse geocoding failed during test start:", e);
          }

          let upgradeUrl = `/api/ip-geo?clientLat=${coords.latitude}&clientLon=${coords.longitude}`;
          if (city) upgradeUrl += `&city=${encodeURIComponent(city)}`;
          if (region) upgradeUrl += `&region=${encodeURIComponent(region)}`;
          if (countryCode) upgradeUrl += `&countryCode=${encodeURIComponent(countryCode)}`;

          const upgradeRes = await fetch(upgradeUrl);
          if (upgradeRes.ok) {
            const upgradeData = await upgradeRes.json();
            currentClientInfo = {
              ...upgradeData,
              isPrecise: true,
            };
            setClientInfo(currentClientInfo);
            initializeLocationData(currentClientInfo);
            clientLat = coords.latitude;
            clientLon = coords.longitude;
            setStatusMessage(`Precise location loaded: ${currentClientInfo?.city || "Unknown City"}, ${currentClientInfo?.country || "Unknown Country"}`);
          }
        } catch (err) {
          console.warn("Failed to upgrade coordinates during test start:", err);
        }
      }
    }

    // Reset stats
    downloadRequestsRef.current = [];
    uploadRequestsRef.current = [];
    unloadedPingStatsRef.current = { sent: 0, lost: 0, latencies: [] };
    dlLoadedPingStatsRef.current = { sent: 0, lost: 0, latencies: [] };
    ulLoadedPingStatsRef.current = { sent: 0, lost: 0, latencies: [] };
    setUnloadedPingStats({ sent: 0, lost: 0, latencies: [] });
    setDlLoadedPingStats({ sent: 0, lost: 0, latencies: [] });
    setUlLoadedPingStats({ sent: 0, lost: 0, latencies: [] });
    setDownloadRequests([]);
    setUploadRequests([]);

    setLatencyStats({
      current: 0,
      avg: 0,
      jitter: 0,
      min: Infinity,
      max: 0,
      latencies: [],
    });
    latencyStatsRef.current = {
      current: 0,
      avg: 0,
      jitter: 0,
      min: Infinity,
      max: 0,
      latencies: [],
    };
    setDownloadStats({ current: 0, avg: 0, peak: 0 });
    downloadStatsRef.current = { current: 0, avg: 0, peak: 0 };
    setUploadStats({ current: 0, avg: 0, peak: 0 });
    uploadStatsRef.current = { current: 0, avg: 0, peak: 0 };
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
      "Connecting to Cloudflare edge (Anycast BGP routing)...",
    ]);
    setActiveProgressLine(null);

    // Single warmup ping to establish connection — Cloudflare BGP handles edge routing
    const edgeNode = await warmupEdge();

    // Launch worker thread
    initCharts();
    setPhase("ping");
    setStatusMessage("Pinging Cloudflare edge…");
    setProgressPercent(40);

    setTerminalLogs((prev) => [
      ...prev,
      "",
      `$ ping -c 15 ${edgeNode.id}`,
      `PING ${edgeNode.name} 56(84) bytes of data.`,
    ]);

    const origin = window.location.origin;
    const baseUrl = `${origin}/api`;
    const region = edgeNode.region;

    // Instantiate worker from local path
    workerRef.current = new Worker(
      new URL("../workers/speedtest.worker.ts", import.meta.url),
      { type: "module" },
    );

    workerRef.current.onmessage = (e: MessageEvent) => {
      const { type, ...data } = e.data;

      switch (type) {
        // Ping Progress Messages
        case "PING_PROGRESS": {
          const stats = {
            sent: data.pingSent || data.iteration,
            lost: data.pingLost || 0,
            latencies: data.latencies || [],
          };
          unloadedPingStatsRef.current = stats;
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
          latencyStatsRef.current = newLatencyStats;
          setProgressPercent(
            40 + Math.round((data.iteration / data.totalIterations) * 10),
          );
          setTerminalLogs((prev) => [
            ...prev,
            `64 bytes from ${edgeNode.id}: icmp_seq=${data.iteration} time=${data.latency.toFixed(1)} ms`,
          ]);
          break;
        }

        case "PING_COMPLETE": {
          const stats = {
            sent: data.pingSent || data.latencies.length,
            lost: data.pingLost || 0,
            latencies: data.latencies || [],
          };
          unloadedPingStatsRef.current = stats;
          setUnloadedPingStats(stats);

          setProgressPercent(50);
          // Transition to Download
          setPhase("download");
          setStatusMessage(
            "Measuring download throughput (concurrent streams)…",
          );

          const pings = data.latencies || [];
          const min = pings.length > 0 ? calculateMin(pings) : 0;
          // Use trimmed mean for latency — eliminates GC pauses and transient spikes (Fix #10)
          const avg = pings.length > 0 ? calculateTrimmedMean(pings) : 0;
          const max = pings.length > 0 ? Math.max(...pings) : 0;
          const jitter = data.jitter || 0;
          const loss = data.pingSent > 0 ? ((data.pingLost / data.pingSent) * 100).toFixed(1) : "0.0";

          // Calculate dynamic warmup based on Bandwidth-Delay Product (Fix #8)
          // BDP = bandwidth × RTT. Higher BDP needs longer warmup for TCP to fill the pipe.
          // Estimate bandwidth from connection API or use a conservative default.
          const estimatedBandwidthBps = clientInfo?.downlink
            ? clientInfo.downlink * 1_000_000
            : avg > 0 ? (10_000_000) : (5_000_000); // conservative 5 Mbps default
          const rttSec = avg / 1000;
          const bdpBytes = estimatedBandwidthBps * rttSec;
          // Warmup needs at least 2× BDP worth of data transfer to fill the TCP window
          const dynamicWarmupMs = Math.min(
            CONFIG.DYNAMIC_WARMUP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil((bdpBytes * 2 / estimatedBandwidthBps) * 1000))
          );
          const dynamicRampMs = Math.min(
            CONFIG.DYNAMIC_RAMP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil((bdpBytes * 4 / estimatedBandwidthBps) * 1000))
          );

          // Adaptive parallel streams based on estimated bandwidth (Fix #7)
          const adaptiveStreams = getAdaptiveStreamCount(
            estimatedBandwidthBps,
            CONFIG.PARALLEL_STREAMS_DEFAULT,
            CONFIG.BANDWIDTH_SLOW_THRESHOLD,
            CONFIG.BANDWIDTH_MEDIUM_THRESHOLD,
            CONFIG.PARALLEL_STREAMS_SLOW,
            CONFIG.PARALLEL_STREAMS_MEDIUM,
            CONFIG.PARALLEL_STREAMS_FAST,
          );

          setTerminalLogs((prev) => [
            ...prev,
            `--- ${edgeNode.id} ping statistics ---`,
            `${data.pingSent} packets transmitted, ${data.pingSent - data.pingLost} received, ${loss}% packet loss`,
            `rtt min/avg/max/mdev = ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)}/${jitter.toFixed(1)} ms`,
            `[INFO] Connection type: ${clientInfo?.connectionType || "unknown"}`,
            `[INFO] BDP estimate: ${(bdpBytes / 1024).toFixed(1)} KB, warmup: ${dynamicWarmupMs}ms, ramp: ${dynamicRampMs}ms`,
            `[INFO] Adaptive streams: ${adaptiveStreams} (estimated bandwidth: ${(estimatedBandwidthBps / 1_000_000).toFixed(1)} Mbps)`,
            "",
            `$ speedtest --download --streams=${adaptiveStreams}`,
            `Starting download throughput test (${adaptiveStreams} streams, ~${((dynamicWarmupMs + dynamicRampMs + CONFIG.DOWNLOAD_MEASURE_MS + CONFIG.DOWNLOAD_PEAK_MS) / 1000).toFixed(0)}s window)...`,
          ]);

          const calculatedAvgPing = avg > 0 ? avg : 20;

          workerRef.current?.postMessage({
            type: "START_DOWNLOAD",
            baseUrl,
            region,
            serverId: edgeNode.id,
            clientLat,
            clientLon,
            basePing: calculatedAvgPing,
            parallelStreams: adaptiveStreams,
            dynamicWarmupMs,
            dynamicRampMs,
          });
          break;
        }

        // Download Progress Messages
        case "DOWNLOAD_PROGRESS": {
          const downloadMbps = data.instantaneousSpeed / 1000000;

          const newDownloadStats = {
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          };
          setDownloadStats(newDownloadStats);
          downloadStatsRef.current = newDownloadStats;

          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);

          updateThroughputChart("download", downloadMbps);
          const dlPct = Math.min(100, Math.round((data.elapsedTime / 20) * 100));
          const dlBarLen = Math.floor(dlPct / 5);
          const dlBar = "█".repeat(dlBarLen) + " ".repeat(20 - dlBarLen);
          setActiveProgressLine(
            `Download: ${downloadMbps.toFixed(1)} Mbps [${dlBar}] ${dlPct}% (${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB transferred)`
          );

          setProgressPercent(
            Math.min(74, 50 + Math.round((data.elapsedTime / 20) * 25)),
          ); // cap at 74% — 20s total download test

          if (data.loadedLatencies) {
            const stats = {
              sent: data.loadedPingSent || 0,
              lost: data.loadedPingLost || 0,
              latencies: data.loadedLatencies || [],
            };
            dlLoadedPingStatsRef.current = stats;
            setDlLoadedPingStats(stats);
          }
          if (data.requests) {
            downloadRequestsRef.current = data.requests;
            setDownloadRequests(data.requests);
          }
          break;
        }

        case "DOWNLOAD_COMPLETE": {
          const stats = {
            sent: data.loadedPingSent || 0,
            lost: data.loadedPingLost || 0,
            latencies: data.loadedLatencies || [],
          };
          dlLoadedPingStatsRef.current = stats;
          setDlLoadedPingStats(stats);

          const newDownloadStats = {
            current: 0,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          };
          setDownloadStats(newDownloadStats);
          downloadStatsRef.current = newDownloadStats;

          if (data.reliable === false) setDownloadReliable(false);

          setProgressPercent(75);
          // Transition to Upload
          setPhase("upload");
          setStatusMessage("Measuring upload throughput (concurrent streams)…");

          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);

          if (data.requests) {
            downloadRequestsRef.current = data.requests;
            setDownloadRequests(data.requests);
          }

          const finalDlMbps = data.averageSpeed / 1000000;
          const reliabilityNote = data.reliable === false
            ? " [UNRELIABLE - insufficient data]"
            : "";

          // Reuse adaptive stream count and dynamic warmup from download phase
          const pings = unloadedPingStatsRef.current.latencies || [];
          const calculatedAvgPing = pings.length > 0 ? calculateTrimmedMean(pings) : 20;

          // Calculate dynamic warmup for upload based on BDP
          const estimatedBandwidthBps = clientInfo?.downlink
            ? clientInfo.downlink * 1_000_000
            : calculatedAvgPing > 0 ? 10_000_000 : 5_000_000;
          const rttSec = calculatedAvgPing / 1000;
          const bdpBytes = estimatedBandwidthBps * rttSec;
          const dynamicWarmupMs = Math.min(
            CONFIG.DYNAMIC_WARMUP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil((bdpBytes * 2 / estimatedBandwidthBps) * 1000))
          );
          const dynamicRampMs = Math.min(
            CONFIG.DYNAMIC_RAMP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil((bdpBytes * 4 / estimatedBandwidthBps) * 1000))
          );

          const adaptiveStreams = getAdaptiveStreamCount(
            estimatedBandwidthBps,
            CONFIG.PARALLEL_STREAMS_DEFAULT,
            CONFIG.BANDWIDTH_SLOW_THRESHOLD,
            CONFIG.BANDWIDTH_MEDIUM_THRESHOLD,
            CONFIG.PARALLEL_STREAMS_SLOW,
            CONFIG.PARALLEL_STREAMS_MEDIUM,
            CONFIG.PARALLEL_STREAMS_FAST,
          );

          setTerminalLogs((prev) => [
            ...prev,
            `Download: ${finalDlMbps.toFixed(1)} Mbps${reliabilityNote} [████████████████████] 100% (Total: ${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
            `[OK] Download test finished.`,
            "",
            `$ speedtest --upload --streams=${adaptiveStreams}`,
            `Starting upload throughput test (${adaptiveStreams} streams, ~${((dynamicWarmupMs + dynamicRampMs + CONFIG.UPLOAD_MEASURE_MS + CONFIG.UPLOAD_PEAK_MS) / 1000).toFixed(0)}s window)...`,
          ]);
          setActiveProgressLine(null);

          workerRef.current?.postMessage({
            type: "START_UPLOAD",
            baseUrl,
            region,
            serverId: edgeNode.id,
            clientLat,
            clientLon,
            basePing: calculatedAvgPing,
            parallelStreams: adaptiveStreams,
            downloadSpeed: downloadStatsRef.current.avg,
            dynamicWarmupMs,
            dynamicRampMs,
          });
          break;
        }

        // Upload Progress Messages
        case "UPLOAD_PROGRESS": {
          const uploadMbps = data.instantaneousSpeed / 1000000;
          const newUploadStats = {
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          };
          setUploadStats(newUploadStats);
          uploadStatsRef.current = newUploadStats;

          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);

          updateThroughputChart("upload", uploadMbps);
          const ulPct = Math.min(100, Math.round((data.elapsedTime / 20) * 100));
          const ulBarLen = Math.floor(ulPct / 5);
          const ulBar = "█".repeat(ulBarLen) + " ".repeat(20 - ulBarLen);
          setActiveProgressLine(
            `Upload: ${uploadMbps.toFixed(1)} Mbps [${ulBar}] ${ulPct}% (${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB transferred)`
          );

          setProgressPercent(
            Math.min(99, 75 + Math.round((data.elapsedTime / 20) * 20)),
          ); // cap at 99% — 20s total upload test

          if (data.loadedLatencies) {
            const stats = {
              sent: data.loadedPingSent || 0,
              lost: data.loadedPingLost || 0,
              latencies: data.loadedLatencies || [],
            };
            ulLoadedPingStatsRef.current = stats;
            setUlLoadedPingStats(stats);
          }
          if (data.requests) {
            uploadRequestsRef.current = data.requests;
            setUploadRequests(data.requests);
          }
          break;
        }

        case "UPLOAD_COMPLETE": {
          const stats = {
            sent: data.loadedPingSent || 0,
            lost: data.loadedPingLost || 0,
            latencies: data.loadedLatencies || [],
          };
          ulLoadedPingStatsRef.current = stats;
          setUlLoadedPingStats(stats);

          const newUploadStats = {
            current: 0,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          };
          setUploadStats(newUploadStats);
          uploadStatsRef.current = newUploadStats;

          if (data.reliable === false) setUploadReliable(false);

          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);

          if (data.requests) {
            uploadRequestsRef.current = data.requests;
            setUploadRequests(data.requests);
          }

          const finalUlMbps = data.averageSpeed / 1000000;
          const reliabilityNote = data.reliable === false
            ? " [UNRELIABLE - insufficient data]"
            : "";
          setTerminalLogs((prev) => [
            ...prev,
            `Upload: ${finalUlMbps.toFixed(1)} Mbps${reliabilityNote} [████████████████████] 100% (Total: ${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
            `[OK] Upload test finished.`,
            "",
            `$ ping -c ${CONFIG.PACKET_LOSS_PINGS} --interval=${CONFIG.PACKET_LOSS_INTERVAL_MS}ms ${edgeNode.id}`,
            `Running dedicated packet loss test (${CONFIG.PACKET_LOSS_PINGS} pings)...`,
          ]);
          setActiveProgressLine(null);

          // Transition to packet loss phase
          setPhase("packetLoss");
          setStatusMessage("Measuring packet loss...");

          // Launch dedicated packet loss test in worker
          workerRef.current?.postMessage({
            type: "START_PACKET_LOSS",
            baseUrl,
            region,
            serverId: edgeNode.id,
            clientLat,
            clientLon,
          });
          break;
        }

        case "PACKET_LOSS_PROGRESS": {
          setTerminalLogs((prev) => [
            ...prev,
            `64 bytes from ${edgeNode.id}: icmp_seq=${data.iteration} loss=${data.lost}/${data.sent}`,
          ]);
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

          // Run packet loss check to finalize the test
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

    // Trigger Ping test inside Worker
    workerRef.current.postMessage({
      type: "START_PING",
      baseUrl,
      region,
      serverId: edgeNode.id,
      clientLat,
      clientLon,
    });
  };

  // 7. Finalize test with real measured packet loss
  const runPacketLossCheck = (realLossPercent: number) => {
    setPhase("complete");
    setProgressPercent(100);
    setStatusMessage("Speed test complete.");
    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setCompletionTime(timeStr);

    // Use the real measured packet loss — no random fallback
    setPacketLoss(realLossPercent);

    setTerminalLogs((prev) => [
      ...prev,
      "--------------------------------------------------",
      `Speedtest execution finished at ${timeStr}`,
      `Server: ${EDGE_NODE.name}`,
      `  Download Speed: ${(downloadStatsRef.current.avg / 1000000).toFixed(1)} Mbps`,
      `  Upload Speed: ${(uploadStatsRef.current.avg / 1000000).toFixed(1)} Mbps`,
      `  Latency (unloaded): ${latencyStatsRef.current.avg.toFixed(1)} ms`,
      `  Jitter: ${latencyStatsRef.current.jitter.toFixed(1)} ms`,
      `  Packet Loss: ${realLossPercent.toFixed(1)}%`,
      "--------------------------------------------------",
      "$",
    ]);

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  };

  const cancelSpeedTest = () => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: "CANCEL" });
      return;
    }
    setPhase("idle");
    setStatusMessage("Test cancelled.");
  };

  const downloadTestResult = () => {
    const allRequests = [
      ...downloadRequestsRef.current,
      ...uploadRequestsRef.current,
    ].sort((a, b) => a.time - b.time);

    const headers = [
      "time",
      "direction",
      "bytes",
      "latency",
      "bps",
      "duration",
      "serverTime",
      "responseSize",
      "loadedLatencies",
    ];
    const csvRows = [headers.join(",")];

    for (const req of allRequests) {
      const pingsStr =
        req.loadedLatencies && req.loadedLatencies.length > 0
          ? req.loadedLatencies.join(" ")
          : "";
      csvRows.push(
        [
          req.time,
          req.direction,
          req.bytes,
          req.latency,
          req.bps,
          req.duration,
          req.serverTime,
          req.responseSize,
          pingsStr,
        ].join(","),
      );
    }
    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `speed-results-${Math.floor(Date.now() / 1000)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8 flex-1">
      {/* 1. Header Hero section */}
      <div className="flex flex-col gap-2 mt-4 md:mt-8 border-b border-hairline pb-6">
        <span className="font-mono text-xs uppercase tracking-wider text-mute block">
          Network Speed Engine
        </span>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-ink font-sans">
          Network Speed Test
        </h1>
        <p className="text-sm md:text-base text-body max-w-2xl mt-1">
          A professional-grade, latency-critical speed test engine measuring
          packet jitters, concurrent downloads, and uploads at the edge.
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 mb-4">
          <a
            href="/about"
            className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors"
          >
            About Us
          </a>
          <span className="text-hairline-strong text-[10px] select-none">
            •
          </span>
          <a
            href="/contact"
            className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors"
          >
            Contact Us
          </a>
          <span className="text-hairline-strong text-[10px] select-none">
            •
          </span>
          <a
            href="/privacy"
            className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors"
          >
            Privacy Policy
          </a>
          <span className="text-hairline-strong text-[10px] select-none">
            •
          </span>
          <a
            href="/terms"
            className="font-mono text-xs uppercase tracking-wider text-mute hover:text-ink transition-colors"
          >
            Terms & Conditions
          </a>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-stretch">
          {phase === "idle" || phase === "complete" || phase === "error" ? (
            <button
              onClick={startSpeedTest}
              type="button"
              className="w-full h-[60px] sm:w-auto bg-primary text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Play
                className="w-4 h-4 fill-on-primary text-on-primary"
                aria-hidden="true"
              />{" "}
              Start Speed Test
            </button>
          ) : (
            <button
              onClick={cancelSpeedTest}
              type="button"
              className="w-full sm:w-auto bg-error text-on-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Square
                className="w-4 h-4 fill-on-primary text-on-primary"
                aria-hidden="true"
              />{" "}
              Stop Test
            </button>
          )}

          {completionTime && downloadStats.avg > 0 ? (
            <button
              onClick={downloadTestResult}
              type="button"
              title="Download results"
              className="w-full h-[60px] sm:w-auto bg-error-soft text-primary font-medium text-sm rounded-full py-2.5 px-6 shadow-sm hover:opacity-90 active:scale-[0.97] hover:shadow-md transition-[opacity,transform,box-shadow] duration-200 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary flex items-center justify-center gap-2 cursor-pointer select-none"
            >
              <Download
                className="w-4 h-4 fill-primary text-primary"
                aria-hidden="true"
              />{" "}
              Download Results
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
      {phase !== "idle" && phase !== "complete" && phase !== "error" ? (
        <div
          className="w-full flex flex-col gap-2 bg-canvas border border-hairline p-4 rounded-lg shadow-xs"
          aria-live="polite"
        >
          <div className="flex justify-between items-center text-xs font-mono text-mute">
            <span>PROGRESS</span>
            <span className="tabular-nums">{progressPercent}%</span>
          </div>
          <div className="w-full bg-canvas-soft-2 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width,background-color] duration-300"
              style={{
                width: `${progressPercent}%`,
                backgroundColor:
                  phase === "download"
                    ? "#eb6f20"
                    : phase === "upload"
                      ? "#8b5cf6"
                      : "var(--color-primary)",
              }}
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="w-2 h-2 rounded-full bg-success animate-ping"
              aria-hidden="true"
            />
            <span className="text-wrap text-xs text-body font-mono truncate">
              {statusMessage}
            </span>
          </div>
        </div>
      ) : null}

      {/* Side-by-side Layout: Web Dashboard on Left, Terminal Simulator on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column - Web UI Dashboard */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* 3. Main Dashboard Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">
            {/* Column 1: Download & Upload */}
            <div className="md:col-span-8 flex flex-col gap-4 bg-canvas border border-hairline p-6 rounded-lg shadow-xs justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
                  <span>DOWNLOAD</span>
                  <InfoTooltip content="The speed at which data is transferred from the internet to your device. Higher download speeds enable smoother video streaming, faster file downloads, and quicker webpage loading." />
                </div>

                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                    {phase === "download"
                      ? formatSpeed(downloadStats.current).value
                      : downloadStats.avg > 0
                        ? formatSpeed(downloadStats.avg).value
                        : "0.0"}
                  </span>
                  <span className="text-xl text-mute font-mono">
                    {phase === "download"
                      ? formatSpeed(downloadStats.current).unit
                      : downloadStats.avg > 0
                        ? formatSpeed(downloadStats.avg).unit
                        : "Mbps"}
                  </span>
                </div>

                {/* Orange Area Chart */}
                <div className="h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
                  <canvas ref={downloadChartRef} />
                  {(phase === "idle" ||
                    phase === "routing" ||
                    phase === "ping") && (
                      <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
                        Chart starts drawing during download test.
                      </div>
                    )}
                </div>

                <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-2 text-mute">
                  <span>Peak Speed:</span>
                  <span className="font-semibold text-ink tabular-nums">
                    {downloadStats.peak > 0
                      ? `${formatSpeed(downloadStats.peak).value} ${formatSpeed(downloadStats.peak).unit}`
                      : "—"}
                  </span>
                </div>
              </div>
              <hr className="border-hairline w-full h-4" />
              <div>
                <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-2">
                  <span>UPLOAD</span>
                  <InfoTooltip content="The speed at which data is transferred from your device to the internet. Higher upload speeds are critical for smooth video calls, online gaming, uploading large files, and sending emails with attachments." />
                </div>

                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl md:text-6xl font-bold tracking-tighter tabular-nums text-ink">
                    {phase === "upload"
                      ? formatSpeed(uploadStats.current).value
                      : uploadStats.avg > 0
                        ? formatSpeed(uploadStats.avg).value
                        : "0.0"}
                  </span>
                  <span className="text-xl text-mute font-mono">
                    {phase === "upload"
                      ? formatSpeed(uploadStats.current).unit
                      : uploadStats.avg > 0
                        ? formatSpeed(uploadStats.avg).unit
                        : "Mbps"}
                  </span>
                </div>

                {/* Purple Area Chart */}
                <div className="h-44 relative w-full border border-hairline bg-canvas-soft rounded-md overflow-hidden p-2">
                  <canvas ref={uploadChartRef} />
                  {(phase === "idle" ||
                    phase === "routing" ||
                    phase === "ping" ||
                    phase === "download") && (
                      <div className="absolute inset-0 bg-canvas/40 backdrop-blur-xs flex items-center justify-center text-[10px] font-mono text-mute text-center p-4">
                        Chart starts drawing during upload test.
                      </div>
                    )}
                </div>

                <div className="flex justify-between items-center text-xs font-mono border-t border-hairline pt-3 mt-2 text-mute">
                  <span>Peak Speed:</span>
                  <span className="font-semibold text-ink tabular-nums">
                    {uploadStats.peak > 0
                      ? `${formatSpeed(uploadStats.peak).value} ${formatSpeed(uploadStats.peak).unit}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Column 2: Latency, Jitter, Packet Loss Stack */}
            <div className="md:col-span-4 flex flex-col gap-4">
              {/* Latency card */}
              <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-1 flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                      <span>LATENCY</span>
                      <InfoTooltip content="Latency (ping) measures the round-trip response time for data. Lower latency is vital for real-time applications like online gaming or voice calls. Unloaded represents idle latency, while Loaded (Down/Up Arrow) measures latency under heavy network load." />
                    </div>
                    <Wifi className="w-4 h-4 text-mute" aria-hidden="true" />
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                      {unloadedPingStats.latencies.length > 0
                        ? latencyStats.avg.toFixed(1)
                        : "—"}
                    </span>
                    <span className="text-xs text-mute font-mono">ms (unloaded)</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
                  <div className="flex items-center gap-1">
                    <ArrowDown
                      className="w-3.5 h-3.5 text-[#eb6f20]"
                      aria-hidden="true"
                    />
                    <span>
                      Down:{" "}
                      <span className="font-semibold text-ink font-mono tabular-nums">
                        {dlLoadedPingStats.latencies.length > 0
                          ? `${dlLoadedLatency.toFixed(0)} ms`
                          : "—"}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp
                      className="w-3.5 h-3.5 text-[#8b5cf6]"
                      aria-hidden="true"
                    />
                    <span>
                      Up:{" "}
                      <span className="font-semibold text-ink font-mono tabular-nums">
                        {ulLoadedPingStats.latencies.length > 0
                          ? `${ulLoadedLatency.toFixed(0)} ms`
                          : "—"}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Jitter card */}
              <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-1 flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                      <span>JITTER</span>
                      <InfoTooltip content="Jitter is the variance in latency over time. Steady, consistent latency results in lower jitter, which is essential for smooth audio streams and live gaming. High jitter causes sudden lag spikes." />
                    </div>
                    <Activity className="w-4 h-4 text-mute" aria-hidden="true" />
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                      {unloadedPingStats.latencies.length > 1
                        ? latencyStats.jitter.toFixed(1)
                        : "—"}
                    </span>
                    <span className="text-xs text-mute font-mono">ms</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
                  <div className="flex items-center gap-1">
                    <ArrowDown
                      className="w-3.5 h-3.5 text-[#eb6f20]"
                      aria-hidden="true"
                    />
                    <span>
                      Down:{" "}
                      <span className="font-semibold text-ink font-mono tabular-nums">
                        {dlLoadedPingStats.latencies.length > 1
                          ? `${dlLoadedJitter.toFixed(0)} ms`
                          : "—"}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowUp
                      className="w-3.5 h-3.5 text-[#8b5cf6]"
                      aria-hidden="true"
                    />
                    <span>
                      Up:{" "}
                      <span className="font-semibold text-ink font-mono tabular-nums">
                        {ulLoadedPingStats.latencies.length > 1
                          ? `${ulLoadedJitter.toFixed(0)} ms`
                          : "—"}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Packet Loss card */}
              <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-1 flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                      <span>PACKET LOSS</span>
                      <InfoTooltip content="Packet Loss occurs when data packets fail to reach their destination. Measured via HTTP request failures during dedicated ping phase. Note: HTTP operates over TCP with retransmission, so this measures application-level loss, not raw network packet loss. True network packet loss is typically higher but masked by TCP retransmits." />
                    </div>
                    <AlertTriangle
                      className="w-4 h-4 text-mute"
                      aria-hidden="true"
                    />
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                      {phase === "complete"
                        ? `${packetLoss}%`
                        : phase === "idle"
                          ? "—"
                          : "0.0%"}
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-mute font-mono border-t border-hairline pt-2 mt-4 flex flex-col justify-between items-center gap-1">
                  <span>HTTP-Level Loss (TCP retransmits masked)</span>
                  <span className={`transition-colors duration-150 ${packetLoss > 0 ? "text-error font-semibold" : "text-link font-semibold"}`}>
                    {packetLoss > 0 ? "Suboptimal" : "Excellent"}
                  </span>
                  {packetLoss === 0 && phase === "complete" && (
                    <span className="text-[9px] text-mute italic">Does not reflect raw network loss</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 4. Network Quality Score Panel */}
          <QualityScores
            phase={phase}
            downloadAvg={downloadStats.avg}
            uploadAvg={uploadStats.avg}
            latencyAvg={latencyStats.avg}
            latencyJitter={latencyStats.jitter}
            packetLossPercent={packetLoss}
          />

          {/* 5. Detailed Measurements Breakdown */}
          <DetailedMeasurements
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            unloadedPingStats={unloadedPingStats}
            dlLoadedPingStats={dlLoadedPingStats}
            ulLoadedPingStats={ulLoadedPingStats}
            downloadRequests={downloadRequests}
            uploadRequests={uploadRequests}
          />

          {/* 6. Technical Details Drawer */}
          <TechnicalLogs
            clientInfo={clientInfo}
          />
        </div>

        {/* Right Column - Interactive Terminal Speed Test Simulator */}
        <div className="lg:col-span-4 w-full flex flex-1 flex-col bg-[#0a0a0a] rounded-lg border border-hairline overflow-hidden shadow-md lg:sticky lg:top-20">
          {/* macOS window header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#222222] bg-[#171717] select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] opacity-80" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] opacity-80" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] opacity-80" />
            </div>
            <span className="text-[10px] font-mono text-mute tracking-wider uppercase">speedtest-cli --terminal</span>
            <div className="w-10" />
          </div>

          {/* Terminal output stream body */}
          <div
            ref={terminalBodyRef}
            className="h-full max-h-[calc(100vh-200px)] overflow-y-scroll p-4 flex flex-col gap-1.5 text-left font-mono text-[11px] leading-relaxed text-[#fafafa]"
          >
            {terminalLogs.map((log, index) => {
              let style: React.CSSProperties = { color: "#fafafa" };
              if (log.startsWith("$")) style = { color: "#50e3c2", fontWeight: "bold" };
              else if (log.includes("[OK]")) style = { color: "#0070f3", fontWeight: "500" };
              else if (log.includes("[PROBE]")) style = { color: "#888888" };
              else if (log.includes("[ERROR]") || log.startsWith("Error:")) style = { color: "#ee0000" };

              return (
                <div key={index} style={style} className="whitespace-pre-wrap">
                  {log}
                </div>
              );
            })}
            {activeProgressLine && (
              <div style={{ color: "#e2e8f0" }} className="animate-pulse whitespace-pre-wrap">
                {activeProgressLine}
              </div>
            )}
          </div>

          {/* Terminal prompt input form */}
          <form
            onSubmit={handleCliSubmit}
            className="flex items-center gap-1.5 px-4 py-3 border-t border-[#222222]/80 bg-[#0c0c0c] text-[11px] font-mono text-[#00dfd8]"
          >
            <span>$</span>
            <input
              type="text"
              value={cliInput}
              onChange={(e) => setCliInput(e.target.value)}
              disabled={phase !== "idle" && phase !== "complete" && phase !== "error"}
              placeholder={phase !== "idle" && phase !== "complete" && phase !== "error" ? "Test in progress..." : "Type 'run' or 'help'..."}
              className="flex-1 bg-transparent border-none outline-hidden text-[#fafafa] font-mono p-0 focus:ring-0 text-[11px]"
            />
          </form>
        </div>
      </div>
    </div>
  );
}
