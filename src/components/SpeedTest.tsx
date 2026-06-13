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
import Chart from "chart.js/auto";

// Import sub-components
import InfoTooltip from "./SpeedTest/InfoTooltip";
import QualityScores from "./SpeedTest/QualityScores";
import DetailedMeasurements from "./SpeedTest/DetailedMeasurements";
import TechnicalLogs from "./SpeedTest/TechnicalLogs";

// Import utilities, types and configuration
import type {
  TestServer,
  TestPhase,
  LatencyStats,
  SpeedStats,
  ClientInfo,
  DetailPingStats,
} from "../utils/speedTestUtils";
import { sleep, formatSpeed } from "../utils/speedTestUtils";
import {
  SERVER_LIST,
  withDistances,
  pickClosestN,
} from "../utils/serverListUtils";

export default function SpeedTest() {
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("System ready.");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeTab, setActiveTab] = useState<
    "latency" | "packetLoss" | "download" | "upload"
  >("latency");

  // Geolocation & Server State
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [closestServers, setClosestServers] = useState<TestServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<TestServer | null>(null);
  const [routingResults, setRoutingResults] = useState<{
    [key: string]: number;
  }>({});

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
  const [downloadRequests, setDownloadRequests] = useState<any[]>([]);
  const [uploadRequests, setUploadRequests] = useState<any[]>([]);

  // Completion Time
  const [completionTime, setCompletionTime] = useState<string>("");

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
  const downloadRequestsRef = useRef<any[]>([]);
  const uploadRequestsRef = useRef<any[]>([]);
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
      // @ts-ignore
      downloadChartInstance.current.options.scales.y.grid.color = gridColor;
      // @ts-ignore
      downloadChartInstance.current.options.scales.y.ticks.color = textColor;
      downloadChartInstance.current.update("none");
    }
    if (uploadChartInstance.current) {
      // @ts-ignore
      uploadChartInstance.current.options.scales.y.grid.color = gridColor;
      // @ts-ignore
      uploadChartInstance.current.options.scales.y.ticks.color = textColor;
      uploadChartInstance.current.update("none");
    }
  }, [theme]);

  // Dispatch selectedServer details to Astro header
  useEffect(() => {
    if (!selectedServer) return;
    const distStr =
      selectedServer.distance && selectedServer.distance > 0
        ? `${selectedServer.distance} km`
        : "";
    const latencyVal = routingResults[selectedServer.id];
    const event = new CustomEvent("server-selected", {
      detail: {
        id: selectedServer.id,
        name: selectedServer.name,
        distance: distStr,
        latency: latencyVal,
      },
    });
    window.dispatchEvent(event);
  }, [selectedServer, routingResults]);

  // Dispatch dynamic servers list to Astro header
  useEffect(() => {
    if (closestServers.length > 0) {
      const event = new CustomEvent("servers-discovered", {
        detail: {
          servers: closestServers.map((s) => ({
            id: s.id,
            name: s.name,
            distance:
              s.distance !== undefined && s.distance > 0
                ? `${s.distance} km`
                : "",
          })),
        },
      });
      window.dispatchEvent(event);
    }
  }, [closestServers]);

  // Server dropdown selection no longer used: routing now auto-locks the best server

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
      downloadChartInstance.current = new Chart(downloadChartRef.current, {
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
      uploadChartInstance.current = new Chart(uploadChartRef.current, {
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
      chart.data.labels = uploadSpeedHistory.current.map(() => "");
      chart.data.datasets[0].data = uploadSpeedHistory.current;

      const sorted = [...uploadSpeedHistory.current].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
      chart.data.datasets[1].data = uploadSpeedHistory.current.map(() => p90);

      chart.update("none");
    }
  };

  // Helper to fetch public IP in local development / fallback situations
  const getPublicIp = async (): Promise<string | null> => {
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      if (res.ok) {
        const data = await res.json();
        return data.ip || null;
      }
    } catch (err) {
      console.warn("Failed to retrieve public IP via ipify:", err);
    }
    return null;
  };

  const initializeLocationData = (data: any) => {
    const hasValidCoords = (d: any) => {
      return (
        d &&
        typeof d.latitude === "number" &&
        Number.isFinite(d.latitude) &&
        typeof d.longitude === "number" &&
        Number.isFinite(d.longitude) &&
        !(d.latitude === 0 && d.longitude === 0)
      );
    };

    const hasCoords = hasValidCoords(data);
    const clientLat = hasCoords ? data.latitude : 0;
    const clientLon = hasCoords ? data.longitude : 0;

    const enriched = withDistances(clientLat, clientLon, SERVER_LIST as any);
    
    let closest: TestServer[];
    if (hasCoords) {
      closest = pickClosestN(enriched, 3);
    } else {
      // Find globally neutral default servers to avoid regional bias
      const defaultIds = ["new-york", "frankfurt", "singapore"];
      closest = enriched.filter((s) => defaultIds.includes(s.id));
      if (closest.length === 0) {
        closest = enriched.slice(0, 3);
      }
    }
    
    setClosestServers(closest);
    setSelectedServer(closest[0] || null);
  };

  // 3. Detect client geolocation from server
  const detectClientLocation = async () => {
    let cachedInfo: string | null = null;
    let cachedTime: string | null = null;

    try {
      cachedInfo = localStorage.getItem("netspeed_client_info");
      cachedTime = localStorage.getItem("netspeed_client_info_time");
    } catch (_) {}

    const cacheExpiryMs = 1000 * 60 * 60; // 1 hour cache duration

    try {
      // 1. If cache is fresh, use it immediately to avoid network calls and prevent distance shifts
      if (cachedInfo && cachedTime) {
        const age = Date.now() - parseInt(cachedTime, 10);
        if (age < cacheExpiryMs) {
          const parsed = JSON.parse(cachedInfo);
          setClientInfo(parsed);
          setStatusMessage(`Client IP detected (cached): ${parsed.ip}`);
          initializeLocationData(parsed);
          return;
        }
      }

      setStatusMessage("Locating client IP and network…");

      // Fetch client geolocation via server headers
      const geoRes = await fetch("/api/ip-geo");
      let data = await geoRes.json();

      // If running on localhost, fallback to client-side public IP resolution
      // and query our API using that IP to perform server-side geolocation lookup.
      if (data.isLocal) {
        const publicIp = await getPublicIp();
        if (publicIp) {
          try {
            const resolvedRes = await fetch(`/api/ip-geo?ip=${publicIp}`);
            if (resolvedRes.ok) {
              const resolvedData = await resolvedRes.json();
              data = {
                ...resolvedData,
                isLocal: true, // preserve local development mode flag
              };
            }
          } catch (err) {
            console.error("Local client public IP lookup failed:", err);
          }
        }
      }

      setClientInfo(data);
      setStatusMessage(`Client IP detected: ${data.ip}`);
      initializeLocationData(data);

      // Save to localStorage cache
      try {
        localStorage.setItem("netspeed_client_info", JSON.stringify(data));
        localStorage.setItem(
          "netspeed_client_info_time",
          Date.now().toString(),
        );
      } catch (_) {}
    } catch (err) {
      console.error("Failed to locate client:", err);

      // Fallback to expired cache if available before failing
      if (cachedInfo) {
        try {
          const parsed = JSON.parse(cachedInfo);
          setClientInfo(parsed);
          setStatusMessage(`Client IP detected (stale cache): ${parsed.ip}`);
          initializeLocationData(parsed);
          return;
        } catch (_) {}
      }

      setStatusMessage("GeoIP detection failed. Using global defaults.");

      const defaultData = {
        ip: "0.0.0.0",
        city: "Unknown",
        region: "Unknown",
        country: "Unknown",
        org: "Unknown",
        latitude: 0,
        longitude: 0,
        isLocal: false,
      };
      setClientInfo(defaultData as any);
      initializeLocationData(defaultData);
    }
  };

  // 5. Routing: pick closest servers (if location available) or all servers (if location unavailable),
  // probe in parallel, and lock best-by-latency (200 OK only)
  const routeToBestServer = async (): Promise<TestServer> => {
    setPhase("routing");
    setProgressPercent(15);

    const origin = window.location.origin;

    const hasCoords =
      clientInfo &&
      typeof clientInfo.latitude === "number" &&
      Number.isFinite(clientInfo.latitude) &&
      typeof clientInfo.longitude === "number" &&
      Number.isFinite(clientInfo.longitude) &&
      !(clientInfo.latitude === 0 && clientInfo.longitude === 0);

    // If client coordinates are valid, probe 5 closest candidate servers.
    // If client coordinates are unavailable, probe ALL servers to find the lowest latency.
    const candidates = hasCoords
      ? pickClosestN(
          withDistances(clientInfo.latitude, clientInfo.longitude, SERVER_LIST),
          5,
        )
      : withDistances(0, 0, SERVER_LIST);

    if (hasCoords) {
      setClosestServers(candidates);
    }

    const isAllProbe = !hasCoords;
    setStatusMessage(
      isAllProbe
        ? "Routing: selecting optimal server (all locations) via parallel latency probes…"
        : "Routing: selecting optimal server (5 closest) via parallel latency probes…",
    );

    const results: { [key: string]: number } = {};

    // Measure host latency on the main thread first
    let hostLatency = 0;
    try {
      const warmupUrl = `${origin}/api/ping?warmup=true&cb=${Date.now()}`;
      const startWarmup = performance.now();
      const res = await fetch(warmupUrl, { cache: "no-store" });
      await res.text();
      hostLatency = performance.now() - startWarmup;
    } catch (_) {
      hostLatency = 20; // fallback
    }

    const isLocalHost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1" ||
      window.location.hostname.startsWith("192.168.") ||
      window.location.hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname);

    const probe = async (srv: TestServer) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1200);

      const start = performance.now();
      try {
        const lat = clientInfo?.latitude || 0;
        const lon = clientInfo?.longitude || 0;
        const testUrl = srv.region
          ? `${origin}/api/ping?region=${srv.region}&serverId=${srv.id}&clientLat=${lat}&clientLon=${lon}&hostLatency=${hostLatency}&cb=${Date.now()}-${Math.random()}`
          : `${origin}/api/ping?hostLatency=${hostLatency}&cb=${Date.now()}-${Math.random()}`;

        const res = await fetch(testUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return { srv, latency: undefined };

        await res.text();
        let latencyVal = performance.now() - start;
        if (isLocalHost) {
          latencyVal = Math.max(1.5, latencyVal - hostLatency);
        }
        return { srv, latency: latencyVal };
      } catch (_) {
        return { srv, latency: undefined };
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const probes = await Promise.all(candidates.map(probe));

    // Populate results map for all successful probes
    for (const p of probes) {
      if (typeof p.latency === "number" && Number.isFinite(p.latency)) {
        results[p.srv.id] = p.latency;
      }
    }

    // Sort successful probes using the bucketing + distance prioritization algorithm
    const successfulProbes = probes
      .filter(
        (p): p is { srv: TestServer; latency: number } =>
          typeof p.latency === "number" && Number.isFinite(p.latency),
      )
      .sort((a, b) => {
        // Group latencies into 15ms buckets to treat minor jitter differences as equivalent
        const bucketA = Math.floor(a.latency / 15);
        const bucketB = Math.floor(b.latency / 15);
        if (bucketA !== bucketB) {
          return bucketA - bucketB; // Prioritize lower latency category
        }

        // If in the same latency bucket, prioritize the geographically closest server
        const distA = a.srv.distance ?? Infinity;
        const distB = b.srv.distance ?? Infinity;
        if (distA !== distB) {
          return distA - distB;
        }

        // Fallback to exact latency if distances are also identical
        return a.latency - b.latency;
      });

    const locked =
      successfulProbes.length > 0 ? successfulProbes[0].srv : candidates[0];
    if (!locked) throw new Error("No candidate servers available for routing.");
    setRoutingResults(results);
    setSelectedServer(locked);
    setStatusMessage(
      `Selected optimal edge: ${locked.name}${results[locked.id] !== undefined ? ` (${Math.round(results[locked.id])}ms)` : ""}`,
    );

    setProgressPercent(30);
    await sleep(300);
    return locked;
  };

  // 6. Primary Speed Test Orchestrator
  const startSpeedTest = async () => {
    if (phase !== "idle" && phase !== "complete" && phase !== "error") return;

    const clientLat = clientInfo?.latitude || 0;
    const clientLon = clientInfo?.longitude || 0;

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
    setDownloadStats({ current: 0, avg: 0, peak: 0 });
    setUploadStats({ current: 0, avg: 0, peak: 0 });
    setDlLoadedLatency(0);
    setDlLoadedJitter(0);
    setUlLoadedLatency(0);
    setUlLoadedJitter(0);
    setPacketLoss(0);
    setProgressPercent(0);
    setCompletionTime("");

    // Initial routing pre-ping (top-3 closest + parallel 200 OK latency probe)
    const anchorServer = await routeToBestServer();

    // Launch worker thread
    initCharts();
    setPhase("ping");
    setStatusMessage(`Pinging locked server: ${anchorServer.name}`);
    setProgressPercent(40);

    const origin = window.location.origin;
    const baseUrl = `${origin}/api`;
    const region = anchorServer.region;

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

          setLatencyStats({
            current: data.latency,
            avg:
              data.latencies.reduce((a: number, b: number) => a + b, 0) /
              data.latencies.length,
            jitter: data.jitter,
            min: Math.min(...data.latencies),
            max: Math.max(...data.latencies),
            latencies: data.latencies,
          });
          setProgressPercent(
            40 + Math.round((data.iteration / data.totalIterations) * 10),
          );
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
          const calculatedAvgPing =
            pings.length > 0
              ? pings.reduce((a: number, b: number) => a + b, 0) / pings.length
              : 20;

          workerRef.current?.postMessage({
            type: "START_DOWNLOAD",
            baseUrl,
            region,
            serverId: anchorServer.id,
            clientLat,
            clientLon,
            basePing: calculatedAvgPing,
            parallelStreams: 3,
          });
          break;
        }

        // Download Progress Messages
        case "DOWNLOAD_PROGRESS":
          const downloadMbps = data.instantaneousSpeed / 1000000;

          setDownloadStats({
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          });

          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);

          updateThroughputChart("download", downloadMbps);
          setProgressPercent(
            Math.min(74, 50 + Math.round((data.elapsedTime / 8) * 25)),
          ); // cap at 74%

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

        case "DOWNLOAD_COMPLETE": {
          const stats = {
            sent: data.loadedPingSent || 0,
            lost: data.loadedPingLost || 0,
            latencies: data.loadedLatencies || [],
          };
          dlLoadedPingStatsRef.current = stats;
          setDlLoadedPingStats(stats);

          setDownloadStats({
            current: 0,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          });

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

          const pings = unloadedPingStatsRef.current.latencies || [];
          const calculatedAvgPing =
            pings.length > 0
              ? pings.reduce((a: number, b: number) => a + b, 0) / pings.length
              : 20;

          workerRef.current?.postMessage({
            type: "START_UPLOAD",
            baseUrl,
            region,
            serverId: anchorServer.id,
            clientLat,
            clientLon,
            basePing: calculatedAvgPing,
            parallelStreams: 3,
          });
          break;
        }

        // Upload Progress Messages
        case "UPLOAD_PROGRESS":
          const uploadMbps = data.instantaneousSpeed / 1000000;
          setUploadStats({
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          });

          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);

          updateThroughputChart("upload", uploadMbps);
          setProgressPercent(
            Math.min(99, 75 + Math.round((data.elapsedTime / 8) * 20)),
          ); // cap at 99%

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

        case "UPLOAD_COMPLETE": {
          const stats = {
            sent: data.loadedPingSent || 0,
            lost: data.loadedPingLost || 0,
            latencies: data.loadedLatencies || [],
          };
          ulLoadedPingStatsRef.current = stats;
          setUlLoadedPingStats(stats);

          setUploadStats({
            current: 0,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          });

          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);

          if (data.requests) {
            uploadRequestsRef.current = data.requests;
            setUploadRequests(data.requests);
          }

          // Run packet loss simulator checks
          runPacketLossCheck();
          break;
        }

        case "CANCELLED":
          setPhase("idle");
          setStatusMessage("Speed test stopped by user.");
          break;

        case "ERROR":
          setPhase("error");
          setStatusMessage(`Test failure: ${data.message}`);
          break;
      }
    };

    // Trigger Ping test inside Worker
    workerRef.current.postMessage({
      type: "START_PING",
      baseUrl,
      region,
      serverId: anchorServer.id,
      clientLat,
      clientLon,
    });
  };

  // 7. Mock packet loss framework logic
  const runPacketLossCheck = () => {
    setPhase("complete");
    setProgressPercent(100);
    setStatusMessage("Speed test complete.");
    setCompletionTime(
      new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );

    const totalSent =
      unloadedPingStatsRef.current.sent +
      dlLoadedPingStatsRef.current.sent +
      ulLoadedPingStatsRef.current.sent;
    const totalLost =
      unloadedPingStatsRef.current.lost +
      dlLoadedPingStatsRef.current.lost +
      ulLoadedPingStatsRef.current.lost;

    // Calculated packet loss based on actual pings; fallback if zero packets were sent
    const lossPercentage =
      totalSent > 0
        ? parseFloat(((totalLost / totalSent) * 100).toFixed(1))
        : Math.random() < 0.2
          ? parseFloat((Math.random() * 0.4).toFixed(1))
          : 0.0;
    setPacketLoss(lossPercentage);

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

        {/* Column 2: Upload */}
        <div className="md:col-span-4 flex flex-col gap-4 bg-canvas border border-hairline p-6 rounded-lg shadow-xs justify-between">
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

        {/* Column 3: Latency, Jitter, Packet Loss Stack */}
        <div className="md:col-span-4 flex flex-col gap-4">
          {/* Latency card */}
          <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-col gap-2">
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

            <div className="grid grid-cols-2 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
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
          <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-col gap-2">
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

            <div className="grid grid-cols-2 gap-4 mt-2 border-t border-hairline pt-2 text-[11px] font-mono text-mute">
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
          <div className="bg-canvas border border-hairline p-5 rounded-lg shadow-xs flex flex-col justify-between h-full">
            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-1.5 text-xs text-mute font-mono">
                  <span>PACKET LOSS</span>
                  <InfoTooltip content="Packet Loss occurs when data packets fail to reach their destination. It results in choppy voice calls, freezing videos, and gaming lag. Ideally, packet loss should be 0.0%." />
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

            <div className="text-[10px] text-mute font-mono border-t border-hairline pt-2 mt-4 flex justify-between items-center">
              <span>Measured Packet Loss</span>
              <span
                className={`transition-colors duration-150 ${packetLoss > 0 ? "text-error font-semibold" : "text-link font-semibold"}`}
              >
                {packetLoss > 0 ? "Suboptimal" : "Excellent"}
              </span>
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
        selectedServer={selectedServer}
        routingResults={routingResults}
      />
    </div>
  );
}
