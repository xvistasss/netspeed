import { useState, useEffect, useRef } from "react";
import type { UseSpeedTestReturn } from "../types";
import { useSpeedTestCharts } from "./useSpeedTestCharts";
import { useTerminalLogs } from "./useTerminalLogs";
import { useGeolocation } from "./useGeolocation";
import { useSpeedTestRunner } from "./useSpeedTestRunner";

/**
 * Top-level React Hook for Speed Test Orchestration
 * Coordinates specialized sub-hooks for charts, terminal logs, geolocation, and test execution.
 */
export function useSpeedTest(): UseSpeedTestReturn {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeTab, setActiveTab] = useState<"latency" | "packetLoss" | "download" | "upload">(
    "latency",
  );
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);

  const startSpeedTestRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const cancelSpeedTestRef = useRef<() => void>(() => {});

  const {
    downloadChartRef,
    uploadChartRef,
    initCharts,
    updateThroughputChart,
  } = useSpeedTestCharts(theme);

  const {
    clientInfo,
    clientInfoRef,
    locationPrePromptWaiting,
    locationPrePromptTimeLeft,
    skipLocationPrompt,
    allowLocationPrompt,
    resetLocationPrompt,
    detectClientLocation,
    upgradeToPreciseLocation,
  } = useGeolocation({
    appendLogs: (lines) => terminal.appendLogs(lines),
    setStatusMessage: (msg) => runner.statusMessage,
  });

  const terminal = useTerminalLogs({
    phase: "idle",
    isStarting: false,
    startSpeedTest: () => startSpeedTestRef.current(),
    cancelSpeedTest: () => cancelSpeedTestRef.current(),
    locationPrePromptWaiting,
    skipLocationPrompt,
    allowLocationPrompt,
    resetLocationPrompt,
    detectClientLocation,
    upgradeToPreciseLocation,
    getClientInfo: () => clientInfoRef.current,
  });

  const runner = useSpeedTestRunner({
    clientInfoRef,
    detectClientLocation,
    upgradeToPreciseLocation,
    skipLocationPrompt,
    appendLogs: terminal.appendLogs,
    setTerminalLogs: terminal.setTerminalLogs,
    setActiveProgressLine: terminal.setActiveProgressLine,
    initCharts,
    updateThroughputChart,
  });

  useEffect(() => {
    startSpeedTestRef.current = runner.startSpeedTest;
    cancelSpeedTestRef.current = runner.cancelSpeedTest;
  });

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setTheme(customEvent.detail.theme);
    };
    window.addEventListener("theme-changed", handleThemeChange);

    const storedTerminalOpen = localStorage.getItem("terminal-open") === "true";
    setIsTerminalOpen(storedTerminalOpen);

    const handleTerminalToggle = (e: Event) => {
      const customEvent = e as CustomEvent;
      setIsTerminalOpen(customEvent.detail.open);
    };
    window.addEventListener("toggle-terminal", handleTerminalToggle);

    const conn = (navigator as any).connection;
    let networkChangeHandler: (() => void) | null = null;
    if (conn && typeof conn.addEventListener === "function") {
      networkChangeHandler = () => {
        if (clientInfoRef.current) detectClientLocation();
      };
      conn.addEventListener("change", networkChangeHandler);
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && clientInfoRef.current) {
        detectClientLocation();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("theme-changed", handleThemeChange);
      window.removeEventListener("toggle-terminal", handleTerminalToggle);
      if (conn && networkChangeHandler && typeof conn.removeEventListener === "function") {
        conn.removeEventListener("change", networkChangeHandler);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [detectClientLocation, clientInfoRef]);

  return {
    ...runner,
    activeTab,
    setActiveTab,
    clientInfo,
    terminalLogs: terminal.terminalLogs,
    activeProgressLine: terminal.activeProgressLine,
    cliInput: terminal.cliInput,
    setCliInput: terminal.setCliInput,
    handleCliSubmit: terminal.handleCliSubmit,
    isTerminalOpen,
    terminalBodyRef: terminal.terminalBodyRef,
    downloadChartRef,
    uploadChartRef,
    skipLocationPrompt,
    allowLocationPrompt,
    resetLocationPrompt,
    locationPrePromptWaiting,
    locationPrePromptTimeLeft,
  };
}
