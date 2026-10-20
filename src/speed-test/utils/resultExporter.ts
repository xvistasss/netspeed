import type { SpeedTestRequest } from "../types";

/**
 * Exports speed test raw request metrics as a downloadable CSV.
 */
export function downloadTestResultCsv(
  downloadRequests: SpeedTestRequest[],
  uploadRequests: SpeedTestRequest[],
): void {
  const allRequests = [...downloadRequests, ...uploadRequests].sort((a, b) => a.time - b.time);
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
  const rows = allRequests.map((r) => [
    r.time,
    r.direction,
    r.bytes,
    r.latency.toFixed(2),
    r.bps.toFixed(0),
    r.duration.toFixed(2),
    r.serverTime.toFixed(2),
    r.responseSize,
    `"${r.loadedLatencies.join(";")}"`,
  ]);
  const csvContent = [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `speed-results-${Math.floor(Date.now() / 1000)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
