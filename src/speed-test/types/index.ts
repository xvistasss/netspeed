/**
 * Canonical Types for Speed Test Feature
 * Single Source of Truth (SSOT) for all measurement data models and component contracts.
 */

export type TestPhase =
  | "idle"
  | "routing"
  | "ping"
  | "download"
  | "upload"
  | "packetLoss"
  | "complete"
  | "error";

export interface LatencyStats {
  current: number;
  avg: number;
  jitter: number;
  min: number;
  max: number;
  latencies: number[];
}

export type IcmpSource = "webrtc" | "http-fallback";

export interface IcmpEstimateResult {
  /** Estimated ICMP RTT in ms */
  value: number;
  /** Whether estimate came from WebRTC UDP or HTTP RTT minus fixed offset */
  source: IcmpSource;
  /** Fixed offset subtracted from HTTP RTT (only meaningful for http-fallback) */
  offsetApplied?: number;
}

export interface SpeedStats {
  current: number; // bps
  avg: number; // bps
  peak: number; // bps
}

export interface ClientInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  org: string;
  latitude: number;
  longitude: number;
  isLocal: boolean;
  isPrecise?: boolean;
  isApproximate?: boolean;
  gpsAccuracy?: number; // meters, from navigator.geolocation
  connectionType?: string; // e.g. "wifi", "ethernet", "cellular", "unknown"
  effectiveType?: string; // e.g. "4g", "3g", "2g", "slow-2g"
  downlink?: number; // Mbps estimate from Network Information API
  rtt?: number; // ms estimate from Network Information API
}

export interface DetailPingStats {
  sent: number;
  lost: number;
  latencies: number[];
}

export interface SpeedTestRequest {
  time: number;
  direction: "download" | "upload";
  bytes: number;
  payloadSize: number;
  phaseSize: number;
  latency: number;
  bps: number;
  duration: number;
  serverTime: number;
  responseSize: number;
  loadedLatencies: number[];
  phaseName?: string;
  error?: string;
}

export interface EdgeLocation {
  id: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
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

export interface TerminalLogEntry {
  text: string;
  style?: "command" | "ok" | "probe" | "error" | "default";
}

export interface QualityScoreResult {
  total: number;
  grade: string;
  gradeColor: string;
  dlScore: number;
  ulScore: number;
  latScore: number;
  jitScore: number;
  lossScore: number;
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
  skipLocationPrompt: () => void;
  allowLocationPrompt: () => void;
  resetLocationPrompt: () => void;
  locationPrePromptWaiting: boolean;
  locationPrePromptTimeLeft: number | null;
}
