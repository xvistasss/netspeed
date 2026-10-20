/**
 * Canonical Public Interface for Speed Test Feature
 * Single Source of Truth (SSOT)
 */

export * from "./types";
export * from "./constants";
export * from "./utils";

// Domain Hooks
export { useSpeedTest } from "./hooks/useSpeedTest";
export { useSpeedTestRunner } from "./hooks/useSpeedTestRunner";
export { useSpeedTestCharts } from "./hooks/useSpeedTestCharts";
export { useGeolocation } from "./hooks/useGeolocation";
export { useTerminalLogs } from "./hooks/useTerminalLogs";

// Feature Components (Plug-and-Play)
export * from "./components";

