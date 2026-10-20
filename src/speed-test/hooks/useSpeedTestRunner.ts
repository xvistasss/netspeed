import { useState, useRef, useCallback, useEffect } from "react";
import type {
  TestPhase,
  LatencyStats,
  SpeedStats,
  DetailPingStats,
  SpeedTestRequest,
  IcmpSource,
  ClientInfo,
  ServerSelectionResult,
} from "../types";
import {
  calculateTrimmedMean,
  calculateMin,
  calculateMax,
  getUploadStreamCount,
  calculateICMPEstimate,
  downloadTestResultCsv,
  selectNearestEdge,
  describeServerSelection,
} from "../utils";
import { CONFIG } from "../constants";

let CURRENT_EDGE: ServerSelectionResult | null = null;

export interface UseSpeedTestRunnerOptions {
  clientInfoRef: React.MutableRefObject<ClientInfo | null>;
  detectClientLocation: () => Promise<ClientInfo | null>;
  upgradeToPreciseLocation: () => Promise<ClientInfo | null>;
  skipLocationPrompt: () => void;
  appendLogs: (lines: string[]) => void;
  setTerminalLogs: React.Dispatch<React.SetStateAction<string[]>>;
  setActiveProgressLine: (line: string | null) => void;
  initCharts: () => Promise<void>;
  updateThroughputChart: (type: "download" | "upload", mbps: number) => void;
}

export function useSpeedTestRunner({
  clientInfoRef,
  detectClientLocation,
  upgradeToPreciseLocation,
  skipLocationPrompt,
  appendLogs,
  setTerminalLogs,
  setActiveProgressLine,
  initCharts,
  updateThroughputChart,
}: UseSpeedTestRunnerOptions) {
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("System ready.");
  const [progressPercent, setProgressPercent] = useState(0);
  const [completionTime, setCompletionTime] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const [latencyStats, setLatencyStats] = useState<LatencyStats>({
    current: 0,
    avg: 0,
    jitter: 0,
    min: Infinity,
    max: 0,
    latencies: [],
  });
  const [icmpEstimate, setIcmpEstimate] = useState<number>(0);
  const [webrtcLatency] = useState<number | null>(null);
  const [icmpSource, setIcmpSource] = useState<IcmpSource>("http-fallback");
  const [icmpOffsetApplied, setIcmpOffsetApplied] = useState<number>(0);
  const [downloadStats, setDownloadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [uploadStats, setUploadStats] = useState<SpeedStats>({ current: 0, avg: 0, peak: 0 });
  const [packetLoss, setPacketLoss] = useState<number>(0);

  const [dlLoadedLatency, setDlLoadedLatency] = useState(0);
  const [dlLoadedJitter, setDlLoadedJitter] = useState(0);
  const [ulLoadedLatency, setUlLoadedLatency] = useState(0);
  const [ulLoadedJitter, setUlLoadedJitter] = useState(0);

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

  const stateRef = useRef({
    downloadStats: { current: 0, avg: 0, peak: 0 } as SpeedStats,
    uploadStats: { current: 0, avg: 0, peak: 0 } as SpeedStats,
    latencyStats: { current: 0, avg: 0, jitter: 0, min: Infinity, max: 0, latencies: [] } as LatencyStats,
    unloadedPingStats: { sent: 0, lost: 0, latencies: [] } as DetailPingStats,
    dlLoadedPingStats: { sent: 0, lost: 0, latencies: [] } as DetailPingStats,
    ulLoadedPingStats: { sent: 0, lost: 0, latencies: [] } as DetailPingStats,
    downloadRequests: [] as SpeedTestRequest[],
    uploadRequests: [] as SpeedTestRequest[],
  });

  const workerRef = useRef<Worker | null>(null);
  const isCancelledRef = useRef(false);
  const startDisabled = useRef(false);
  const autorunTriggered = useRef(false);
  const lastTerminalLogTime = useRef(0);
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dlDynamicWarmupMs = useRef<number>(CONFIG.DOWNLOAD_WARMUP_MS);
  const dlDynamicRampMs = useRef<number>(CONFIG.DOWNLOAD_RAMP_MS);
  const ulDynamicWarmupMs = useRef<number>(CONFIG.UPLOAD_WARMUP_MS);
  const ulDynamicRampMs = useRef<number>(CONFIG.UPLOAD_RAMP_MS);
  const dlLoadedIcmpEstimate = useRef<number>(0);
  const ulLoadedIcmpEstimate = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current);
    };
  }, []);

  const warmupServer = useCallback(async (): Promise<{ id: string; name: string; region: string }> => {
    setPhase("routing");
    setProgressPercent(15);
    setStatusMessage("Selecting optimal edge server...");

    const currentClient = clientInfoRef.current;
    if (currentClient?.latitude && currentClient?.longitude) {
      CURRENT_EDGE = selectNearestEdge(currentClient.latitude, currentClient.longitude);
      appendLogs([
        `[INFO] ${describeServerSelection(CURRENT_EDGE)}`,
        `[INFO] Top edges: ${CURRENT_EDGE.allEdges.map((e) => `${e.city} (${e.distanceKm}km)`).join(", ")}`,
      ]);
    } else {
      CURRENT_EDGE = null;
      appendLogs(["[INFO] Geolocation unavailable - using Cloudflare Anycast auto-routing"]);
    }

    const selectedEdge = CURRENT_EDGE?.edge;
    const edgeName = selectedEdge ? `${selectedEdge.city}, ${selectedEdge.country}` : "Cloudflare Edge";
    const edgeId = selectedEdge?.id || "default";
    const edgeRegion = selectedEdge?.region || "auto";

    appendLogs([
      `[INFO] Target: ${edgeName} (${edgeId})`,
      `[INFO] Direct endpoint: ${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}`,
      `[INFO] Fallback proxy: ${CONFIG.SPEED_PROXY_ENDPOINT}`,
    ]);

    try {
      const warmupStart = performance.now();
      const res = await fetch(`${CONFIG.CLOUDFLARE_SPEED_ENDPOINT}/__down?bytes=1`, {
        cache: "no-store",
      });
      const warmupTime = Math.round(performance.now() - warmupStart);
      if (res.ok) {
        appendLogs([`[OK] Edge handshake verified in ${warmupTime}ms (HTTP ${res.status})`]);
      } else {
        appendLogs([`[WARN] Handshake non-200 (${res.status}) in ${warmupTime}ms, proceeding anyway`]);
      }
    } catch {
      appendLogs([`[WARN] Direct handshake failed, falling back to proxy`]);
    }

    return { id: edgeId, name: edgeName, region: edgeRegion };
  }, [appendLogs, clientInfoRef]);

  const runPacketLossCheck = useCallback(
    (realLossPercent: number) => {
      setPhase("complete");
      setProgressPercent(100);
      setStatusMessage("Speed test complete.");
      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
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
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    },
    [setTerminalLogs],
  );

  const startSpeedTest = useCallback(async () => {
    if (startDisabled.current) return;
    if (phase !== "idle" && phase !== "complete" && phase !== "error") return;
    startDisabled.current = true;
    setTimeout(() => {
      startDisabled.current = false;
    }, 1000);

    setIsCancelling(false);
    setIsStarting(true);
    isCancelledRef.current = false;

    await detectClientLocation();

    if (isCancelledRef.current) {
      setIsStarting(false);
      setIsCancelling(false);
      return;
    }

    let currentClientInfo = clientInfoRef.current;
    let clientLat = currentClientInfo?.latitude || 0;
    let clientLon = currentClientInfo?.longitude || 0;

    const isDismissed =
      typeof window !== "undefined" && sessionStorage.getItem("location-prompt-dismissed") === "true";
    if ("geolocation" in navigator && (!currentClientInfo || !currentClientInfo.isPrecise) && !isDismissed) {
      setStatusMessage("Requesting browser geolocation for edge server selection...");
      const upgraded = await upgradeToPreciseLocation();
      if (isCancelledRef.current) {
        setIsStarting(false);
        setIsCancelling(false);
        return;
      }
      if (upgraded) {
        currentClientInfo = upgraded;
        clientLat = upgraded.latitude || 0;
        clientLon = upgraded.longitude || 0;
        setStatusMessage(`Precise location: ${upgraded.city || "Unknown"}, ${upgraded.country || "Unknown"}`);
      } else {
        appendLogs(["[INFO] GPS location unavailable. Using IP-based location for edge selection."]);
        setStatusMessage("GPS unavailable. Using approximate location.");
      }
    }

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
    setIcmpEstimate(0);
    setCompletionTime("");
    setProgressPercent(10);

    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setTerminalLogs((prev) => [
      ...prev,
      "",
      `=== Speedtest Session Started: ${timeStr} ===`,
      `Client: ${currentClientInfo?.ip || "Unknown"} (${currentClientInfo?.city || "Unknown"}, ${currentClientInfo?.country || "Unknown"})`,
      `ISP: ${currentClientInfo?.org || "Unknown"}`,
      "Resolving nearest Cloudflare edge (Anycast DNS routing)...",
    ]);
    setActiveProgressLine(null);

    const edgeNode = await warmupServer();
    if (isCancelledRef.current) {
      setIsStarting(false);
      setIsCancelling(false);
      return;
    }
    await initCharts();
    if (isCancelledRef.current) {
      setIsStarting(false);
      setIsCancelling(false);
      return;
    }

    setIsStarting(false);
    setPhase("ping");
    setStatusMessage("Pinging edge server...");
    setProgressPercent(40);

    setTerminalLogs((prev) => [
      ...prev,
      "",
      `$ ping -c 15 ${edgeNode.name}`,
      `PING ${edgeNode.name} 56(84) bytes of data.`,
    ]);

    const origin = window.location.origin;
    const baseUrl = `${origin}/api`;
    const region = edgeNode.region;

    workerRef.current = new Worker(new URL("../worker/speedtest.worker.ts", import.meta.url), {
      type: "module",
    });

    workerRef.current.onmessage = (e: MessageEvent) => {
      const { type, ...data } = e.data;

      switch (type) {
        case "PING_PROGRESS": {
          const stats = {
            sent: data.pingSent || data.iteration,
            lost: data.pingLost || 0,
            latencies: data.latencies || [],
          };
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

          const now = performance.now();
          if (now - lastTerminalLogTime.current >= 200 || data.iteration === data.totalIterations) {
            lastTerminalLogTime.current = now;
            setTerminalLogs((prev) => [
              ...prev,
              `64 bytes from ${edgeNode.name}: seq=${data.iteration} time=${data.latency.toFixed(1)} ms`,
            ]);
          }
          break;
        }

        case "PING_COMPLETE": {
          const stats = {
            sent: data.pingSent || data.latencies.length,
            lost: data.pingLost || 0,
            latencies: data.latencies || [],
          };
          stateRef.current.unloadedPingStats = stats;
          setUnloadedPingStats(stats);
          setProgressPercent(50);
          setPhase("download");
          setStatusMessage("Measuring download throughput (concurrent streams)...");

          const pings = data.latencies || [];
          const min = pings.length > 0 ? calculateMin(pings) : 0;
          const avg = pings.length > 0 ? calculateTrimmedMean(pings) : 0;
          const max = pings.length > 0 ? calculateMax(pings) : 0;
          const jitter = data.jitter || 0;
          const loss = data.pingSent > 0 ? ((data.pingLost / data.pingSent) * 100).toFixed(1) : "0.0";

          const networkType = clientInfoRef.current?.connectionType || clientInfoRef.current?.effectiveType;
          const icmpResult = calculateICMPEstimate(avg, webrtcLatency, networkType);
          if (icmpResult.value > 0) setIcmpEstimate(icmpResult.value);
          setIcmpSource(icmpResult.source);
          setIcmpOffsetApplied(icmpResult.offsetApplied ?? 0);

          const connDownlink = clientInfoRef.current?.downlink;
          const connDownlinkBps = connDownlink ? connDownlink * 1_000_000 : 0;
          const estimatedBandwidthBps =
            connDownlinkBps > 0 ? connDownlinkBps : avg > 0 ? 50_000_000 : 10_000_000;
          const rttSec = avg / 1000;
          const bdpBytes = estimatedBandwidthBps * rttSec;
          const dynamicWarmupMs = Math.min(
            CONFIG.DYNAMIC_WARMUP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil(((bdpBytes * 2) / estimatedBandwidthBps) * 1000)),
          );
          const dynamicRampMs = Math.min(
            CONFIG.DYNAMIC_RAMP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil(((bdpBytes * 4) / estimatedBandwidthBps) * 1000)),
          );

          dlDynamicWarmupMs.current = dynamicWarmupMs;
          dlDynamicRampMs.current = dynamicRampMs;

          setTerminalLogs((prev) => [
            ...prev,
            `--- ${edgeNode.name} ping statistics ---`,
            `${data.pingSent} packets transmitted, ${data.pingSent - data.pingLost} received, ${loss}% packet loss`,
            `rtt min/avg/max/mdev = ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)}/${jitter.toFixed(1)} ms`,
            `[INFO] ICMP estimate: ${
              icmpResult.source === "webrtc"
                ? `${icmpResult.value.toFixed(1)}ms (WebRTC UDP - closest to ICMP)`
                : `~${icmpResult.value.toFixed(1)}ms (HTTP RTT - ${icmpResult.offsetApplied}ms offset)`
            }`,
            `[INFO] BDP estimate: ${(bdpBytes / 1024).toFixed(1)} KB, warmup: ${dynamicWarmupMs}ms, ramp: ${dynamicRampMs}ms`,
            "",
            `$ speedtest --download --parallel=${CONFIG.PARALLEL_STREAMS_DEFAULT}`,
            `Starting download throughput test (${CONFIG.PARALLEL_STREAMS_DEFAULT} streams, ~${(
              (dynamicWarmupMs + dynamicRampMs + CONFIG.DOWNLOAD_MEASURE_MS + CONFIG.DOWNLOAD_PEAK_MS) /
              1000
            ).toFixed(0)}s window)...`,
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
            dynamicWarmupMs,
            dynamicRampMs,
            networkType,
          });
          break;
        }

        case "DOWNLOAD_PROGRESS": {
          const downloadMbps = data.instantaneousSpeed / 1000000;
          const newDownloadStats = {
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          };
          setDownloadStats(newDownloadStats);
          stateRef.current.downloadStats = newDownloadStats;
          if (data.loadedLatency > 0) setDlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setDlLoadedJitter(data.loadedJitter);
          updateThroughputChart("download", downloadMbps);

          const totalExpectedSec =
            (dlDynamicWarmupMs.current +
              dlDynamicRampMs.current +
              CONFIG.DOWNLOAD_MEASURE_MS +
              CONFIG.DOWNLOAD_PEAK_MS) /
            1000;
          const dlPct = Math.min(100, Math.round((data.elapsedTime / totalExpectedSec) * 100));
          const dlBarLen = Math.floor(dlPct / 5);
          const dlBar = "=".repeat(dlBarLen) + " ".repeat(20 - dlBarLen);
          setActiveProgressLine(
            `Download: ${downloadMbps.toFixed(1)} Mbps [${dlBar}] ${dlPct}% (${(
              data.totalBytes /
              (1024 * 1024)
            ).toFixed(1)} MB transferred)`,
          );
          setProgressPercent(Math.min(74, 50 + Math.round((data.elapsedTime / totalExpectedSec) * 25)));

          if (data.loadedLatencies) {
            const stats = {
              sent: data.loadedPingSent || 0,
              lost: data.loadedPingLost || 0,
              latencies: data.loadedLatencies || [],
            };
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
          const stats = {
            sent: data.loadedPingSent || 0,
            lost: data.loadedPingLost || 0,
            latencies: data.loadedLatencies || [],
          };
          stateRef.current.dlLoadedPingStats = stats;
          setDlLoadedPingStats(stats);
          const newDownloadStats = { current: 0, avg: data.averageSpeed, peak: data.peakSpeed };
          setDownloadStats(newDownloadStats);
          stateRef.current.downloadStats = newDownloadStats;
          setProgressPercent(75);
          setPhase("upload");
          setStatusMessage("Measuring upload throughput (concurrent streams)...");
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

          const measuredDlBps =
            stateRef.current.downloadStats.avg > 0
              ? stateRef.current.downloadStats.avg
              : calculatedAvgPing > 0
                ? 50_000_000
                : 10_000_000;
          const rttSec = calculatedAvgPing / 1000;
          const bdpBytes = measuredDlBps * rttSec;
          const dynamicWarmupMs = Math.min(
            CONFIG.DYNAMIC_WARMUP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_WARMUP_MIN_MS, Math.ceil(((bdpBytes * 2) / measuredDlBps) * 1000)),
          );
          const dynamicRampMs = Math.min(
            CONFIG.DYNAMIC_RAMP_MAX_MS,
            Math.max(CONFIG.DYNAMIC_RAMP_MIN_MS, Math.ceil(((bdpBytes * 4) / measuredDlBps) * 1000)),
          );

          const adaptiveStreams = getUploadStreamCount(measuredDlBps, null);
          ulDynamicWarmupMs.current = dynamicWarmupMs;
          ulDynamicRampMs.current = dynamicRampMs;

          setTerminalLogs((prev) => [
            ...prev,
            `Download: ${finalDlMbps.toFixed(1)} Mbps${reliabilityNote} [====================] 100% (Total: ${(
              data.totalBytes /
              (1024 * 1024)
            ).toFixed(1)} MB)`,
            `[OK] Download test finished.`,
            "",
            `$ speedtest --upload --streams=${adaptiveStreams}`,
            `[INFO] Upload BDP estimate: ${(bdpBytes / 1024).toFixed(1)} KB based on ${finalDlMbps.toFixed(
              1,
            )} Mbps measured download`,
            `Starting upload throughput test (${adaptiveStreams} streams, ~${(
              (dynamicWarmupMs + dynamicRampMs + CONFIG.UPLOAD_MEASURE_MS + CONFIG.UPLOAD_PEAK_MS) /
              1000
            ).toFixed(0)}s window)...`,
          ]);
          setActiveProgressLine(null);

          const uploadNetworkType =
            clientInfoRef.current?.connectionType || clientInfoRef.current?.effectiveType;
          workerRef.current?.postMessage({
            type: "START_UPLOAD",
            baseUrl,
            region,
            serverId: edgeNode.id,
            clientLat,
            clientLon,
            basePing: calculatedAvgPing,
            parallelStreams: adaptiveStreams,
            downloadSpeed: stateRef.current.downloadStats.avg,
            dynamicWarmupMs,
            dynamicRampMs,
            networkType: uploadNetworkType,
          });
          break;
        }

        case "UPLOAD_PROGRESS": {
          const uploadMbps = data.instantaneousSpeed / 1000000;
          const newUploadStats = {
            current: data.instantaneousSpeed,
            avg: data.averageSpeed,
            peak: data.peakSpeed,
          };
          setUploadStats(newUploadStats);
          stateRef.current.uploadStats = newUploadStats;
          if (data.loadedLatency > 0) setUlLoadedLatency(data.loadedLatency);
          if (data.loadedJitter > 0) setUlLoadedJitter(data.loadedJitter);
          updateThroughputChart("upload", uploadMbps);

          const totalExpectedUlSec =
            (ulDynamicWarmupMs.current +
              ulDynamicRampMs.current +
              CONFIG.UPLOAD_MEASURE_MS +
              CONFIG.UPLOAD_PEAK_MS) /
            1000;
          const ulPct = Math.min(100, Math.round((data.elapsedTime / totalExpectedUlSec) * 100));
          const ulBarLen = Math.floor(ulPct / 5);
          const ulBar = "=".repeat(ulBarLen) + " ".repeat(20 - ulBarLen);
          setActiveProgressLine(
            `Upload: ${uploadMbps.toFixed(1)} Mbps [${ulBar}] ${ulPct}% (${(
              data.totalBytes /
              (1024 * 1024)
            ).toFixed(1)} MB transferred)`,
          );
          setProgressPercent(Math.min(99, 75 + Math.round((data.elapsedTime / totalExpectedUlSec) * 20)));

          if (data.loadedLatencies) {
            const stats = {
              sent: data.loadedPingSent || 0,
              lost: data.loadedPingLost || 0,
              latencies: data.loadedLatencies || [],
            };
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
          const stats = {
            sent: data.loadedPingSent || 0,
            lost: data.loadedPingLost || 0,
            latencies: data.loadedLatencies || [],
          };
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
            `Upload: ${finalUlMbps.toFixed(1)} Mbps${reliabilityNote} [====================] 100% (Total: ${(
              data.totalBytes /
              (1024 * 1024)
            ).toFixed(1)} MB)`,
            `[OK] Upload test finished.`,
            "",
            `[INFO] Cooling down for 2 seconds before packet loss test...`,
          ]);
          setActiveProgressLine(null);

          cooldownTimeoutRef.current = setTimeout(() => {
            cooldownTimeoutRef.current = null;
            const lossNetworkType =
              clientInfoRef.current?.connectionType || clientInfoRef.current?.effectiveType;
            const lossInterval =
              lossNetworkType === "cellular" ||
              lossNetworkType?.startsWith("cellular-") ||
              lossNetworkType === "4g" ||
              lossNetworkType === "3g" ||
              lossNetworkType === "2g"
                ? CONFIG.PACKET_LOSS_INTERVAL_CELLULAR_MS
                : CONFIG.PACKET_LOSS_INTERVAL_WIFI_MS;
            setTerminalLogs((prev) => [
              ...prev,
              `$ ping -c ${CONFIG.PACKET_LOSS_PINGS} --interval=${lossInterval}ms ${edgeNode.name}`,
              `Running dedicated packet loss test (${CONFIG.PACKET_LOSS_PINGS} pings)...`,
            ]);
            setPhase("packetLoss");
            setStatusMessage("Measuring packet loss...");
            workerRef.current?.postMessage({
              type: "START_PACKET_LOSS",
              baseUrl,
              region,
              serverId: edgeNode.id,
              clientLat,
              clientLon,
              networkType: lossNetworkType,
            });
          }, 2000);
          break;
        }

        case "PACKET_LOSS_PROGRESS": {
          const now = performance.now();
          if (now - lastTerminalLogTime.current >= 200 || data.iteration === data.totalIterations) {
            lastTerminalLogTime.current = now;
            setTerminalLogs((prev) => [
              ...prev,
              `64 bytes from ${edgeNode.name}: icmp_seq=${data.iteration} loss=${data.lost}/${data.sent}`,
            ]);
          }
          break;
        }

        case "PACKET_LOSS_COMPLETE": {
          setPacketLoss(parseFloat(data.lossPercent.toFixed(1)));
          setTerminalLogs((prev) => [
            ...prev,
            `--- ${edgeNode.name} packet loss statistics ---`,
            `${data.sent} pings transmitted, ${data.sent - data.lost} received, ${data.lossPercent.toFixed(
              1,
            )}% packet loss`,
            "",
          ]);
          runPacketLossCheck(data.lossPercent);
          break;
        }

        case "CANCELLED":
          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
          }
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
    workerRef.current.postMessage({
      type: "START_PING",
      baseUrl,
      region,
      serverId: edgeNode.id,
      clientLat,
      clientLon,
      networkType,
    });
  }, [
    phase,
    appendLogs,
    detectClientLocation,
    upgradeToPreciseLocation,
    warmupServer,
    initCharts,
    updateThroughputChart,
    clientInfoRef,
    setActiveProgressLine,
    setTerminalLogs,
    runPacketLossCheck,
  ]);

  const cancelSpeedTest = useCallback(() => {
    setIsCancelling(true);
    isCancelledRef.current = true;

    if (cooldownTimeoutRef.current) {
      clearTimeout(cooldownTimeoutRef.current);
      cooldownTimeoutRef.current = null;
    }

    skipLocationPrompt();

    if (workerRef.current) {
      workerRef.current.postMessage({ type: "CANCEL" });
      return;
    }
    setPhase("idle");
    setStatusMessage("Test cancelled.");
    setIsCancelling(false);
    setIsStarting(false);
  }, [skipLocationPrompt]);

  const downloadTestResult = useCallback(() => {
    downloadTestResultCsv(stateRef.current.downloadRequests, stateRef.current.uploadRequests);
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("autorun") === "true" && !autorunTriggered.current) {
      autorunTriggered.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("autorun");
      window.history.replaceState({}, document.title, url.pathname + url.search);
      startSpeedTest();
    }
  }, [startSpeedTest]);

  return {
    phase,
    statusMessage,
    progressPercent,
    completionTime,
    isStarting,
    isCancelling,
    latencyStats,
    icmpEstimate,
    webrtcLatency,
    icmpSource,
    icmpOffsetApplied,
    downloadStats,
    uploadStats,
    packetLoss,
    dlLoadedLatency,
    dlLoadedJitter,
    ulLoadedLatency,
    ulLoadedJitter,
    unloadedPingStats,
    dlLoadedPingStats,
    ulLoadedPingStats,
    downloadRequests,
    uploadRequests,
    startSpeedTest,
    cancelSpeedTest,
    downloadTestResult,
  };
}
