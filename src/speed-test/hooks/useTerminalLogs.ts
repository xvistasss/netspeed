import { useState, useRef, useCallback, useEffect } from "react";
import type { ClientInfo, TestPhase } from "../types";

export interface TerminalCommandsDeps {
  phase: TestPhase;
  isStarting: boolean;
  startSpeedTest: () => Promise<void>;
  cancelSpeedTest: () => void;
  locationPrePromptWaiting: boolean;
  skipLocationPrompt: () => void;
  allowLocationPrompt: () => void;
  resetLocationPrompt: () => void;
  detectClientLocation: () => Promise<ClientInfo | null>;
  upgradeToPreciseLocation: () => Promise<ClientInfo | null>;
  getClientInfo: () => ClientInfo | null;
}

export function useTerminalLogs(deps: TerminalCommandsDeps) {
  const MAX_LOG_ENTRIES = 500;
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "NetSpeed Diagnostic Terminal v1.2",
    "Type 'help' for available commands, or 'run' to start.",
    "$",
  ]);
  const [activeProgressLine, setActiveProgressLine] = useState<string | null>(null);
  const [cliInput, setCliInput] = useState("");
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

  const appendLogs = useCallback((newLines: string[]) => {
    setTerminalLogs((prev) => {
      const combined = [...prev, ...newLines];
      return combined.length > MAX_LOG_ENTRIES
        ? combined.slice(combined.length - MAX_LOG_ENTRIES)
        : combined;
    });
  }, []);

  // Auto-scroll terminal to bottom when logs update
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [terminalLogs, activeProgressLine]);

  const handleCliSubmit = useCallback(
    async (e: React.SubmitEvent) => {
      e.preventDefault();
      const rawInput = cliInput.trim();
      if (!rawInput) return;
      appendLogs([`$ ${rawInput}`]);
      setCliInput("");

      const parts = rawInput.toLowerCase().split(/\s+/);
      const cmd = parts[0];
      const subCmd = parts[1];

      const printLocationInfo = (info: ClientInfo | null) => {
        if (!info) {
          appendLogs(["[ERROR] No location information currently available."]);
          return;
        }
        const locationParts = [info.city, info.region, info.country].filter(Boolean);
        const locationStr = locationParts.length > 0 ? locationParts.join(", ") : "Unknown";
        const coordsStr =
          info.latitude || info.longitude
            ? `${info.latitude.toFixed(4)}°, ${info.longitude.toFixed(4)}°`
            : "Unavailable";
        const precisionStr = info.isPrecise
          ? `Precise GPS (+/-${info.gpsAccuracy ?? 0}m)`
          : "Approximate (IP Geolocation)";

        const lines = [
          "[OK] Client Location Information:",
          `  * IP Address:   ${info.ip || "Unknown"}`,
          `  * Location:     ${locationStr}`,
          `  * Coordinates:  ${coordsStr}`,
          `  * Provider/Org: ${info.org || "Unknown"}`,
          `  * Precision:    ${precisionStr}`,
        ];

        if (info.connectionType || info.effectiveType) {
          lines.push(
            `  * Connection:   ${info.connectionType || "unknown"} (${info.effectiveType || "N/A"}${info.rtt ? `, ${info.rtt}ms RTT` : ""})`,
          );
        }

        if (!info.isPrecise) {
          lines.push(`[INFO] Type 'location gps' to request high-precision hardware GPS coordinates.`);
        }

        appendLogs(lines);
      };

      if (cmd === "clear") {
        setTerminalLogs([]);
        setActiveProgressLine(null);
      } else if (cmd === "help") {
        appendLogs([
          "Available commands:",
          "  run, speedtest    - Start the network speed test",
          "  stop, cancel      - Stop the running speed test",
          "  location [subcmd] - View or manage location (info, gps, refresh, reset)",
          "  allow, skip       - Allow or skip location permission prompt",
          "  ip, whoami        - Display client IP and GeoIP details",
          "  clear             - Clear the terminal screen",
          "  help              - Show this help message",
        ]);
      } else if (cmd === "run" || cmd === "speedtest") {
        if (deps.phase !== "idle" && deps.phase !== "complete" && deps.phase !== "error") {
          appendLogs(["Error: A speed test is already running."]);
        } else {
          deps.startSpeedTest();
        }
      } else if (cmd === "stop" || cmd === "cancel") {
        if (deps.phase === "idle" && !deps.isStarting) {
          appendLogs(["No speed test is currently running."]);
        } else {
          deps.cancelSpeedTest();
        }
      } else if (cmd === "skip") {
        if (deps.locationPrePromptWaiting) {
          deps.skipLocationPrompt();
        } else {
          appendLogs(["No active location prompt to skip."]);
        }
      } else if (cmd === "allow") {
        if (deps.locationPrePromptWaiting) {
          deps.allowLocationPrompt();
          appendLogs(["[INFO] Location permission prompt accepted. Requesting GPS..."]);
        } else if (!deps.getClientInfo()?.isPrecise) {
          appendLogs(["[INFO] Requesting browser GPS geolocation..."]);
          const upgraded = await deps.upgradeToPreciseLocation();
          if (upgraded) {
            printLocationInfo(upgraded);
          } else {
            appendLogs(["[WARN] GPS geolocation unavailable or denied."]);
          }
        } else {
          appendLogs(["[INFO] Precise location is already active."]);
        }
      } else if (cmd === "location" || cmd === "ip" || cmd === "whoami" || cmd === "geoip") {
        if (subCmd === "reset" || subCmd === "--reset" || subCmd === "-r") {
          deps.resetLocationPrompt();
        } else if (subCmd === "gps" || subCmd === "precise" || subCmd === "--gps" || subCmd === "-g") {
          if (!("geolocation" in navigator)) {
            appendLogs(["[ERROR] Geolocation API is not supported in this browser."]);
          } else {
            appendLogs(["[INFO] Requesting high-precision device GPS coordinates..."]);
            const upgraded = await deps.upgradeToPreciseLocation();
            if (upgraded) {
              printLocationInfo(upgraded);
            } else {
              appendLogs(["[WARN] GPS location could not be obtained. Showing current location:"]);
              let current = deps.getClientInfo();
              if (!current) {
                current = await deps.detectClientLocation();
              }
              printLocationInfo(current);
            }
          }
        } else if (subCmd === "refresh" || subCmd === "reload" || subCmd === "detect" || subCmd === "--refresh") {
          appendLogs(["[INFO] Refreshing client IP and location data..."]);
          const refreshed = await deps.detectClientLocation();
          printLocationInfo(refreshed);
        } else if (subCmd === "allow") {
          if (deps.locationPrePromptWaiting) {
            deps.allowLocationPrompt();
            appendLogs(["[INFO] Location permission prompt accepted."]);
          } else if (!deps.getClientInfo()?.isPrecise) {
            appendLogs(["[INFO] Requesting browser GPS geolocation..."]);
            const upgraded = await deps.upgradeToPreciseLocation();
            if (upgraded) {
              printLocationInfo(upgraded);
            }
          } else {
            appendLogs(["[INFO] Precise location is already active."]);
          }
        } else if (subCmd === "skip") {
          if (deps.locationPrePromptWaiting) {
            deps.skipLocationPrompt();
          } else {
            appendLogs(["No active location prompt to skip."]);
          }
        } else if (subCmd === "help" || subCmd === "--help" || subCmd === "-h") {
          appendLogs([
            "Location commands:",
            "  location            - View current detected location and network info",
            "  location gps        - Request high-precision device GPS coordinates",
            "  location refresh    - Re-detect IP geolocation & network info",
            "  location reset      - Reset location prompt preferences",
            "  location allow|skip - Respond to active location permission prompt",
          ]);
        } else {
          let current = deps.getClientInfo();
          if (!current) {
            appendLogs(["[INFO] Detecting client location..."]);
            current = await deps.detectClientLocation();
          }
          printLocationInfo(current);
        }
      } else {
        appendLogs([`Unknown command: ${cmd}. Type 'help' for options.`]);
      }
    },
    [cliInput, deps, appendLogs],
  );

  return {
    terminalLogs,
    setTerminalLogs,
    appendLogs,
    activeProgressLine,
    setActiveProgressLine,
    cliInput,
    setCliInput,
    handleCliSubmit,
    terminalBodyRef,
  };
}
