import type { ClientInfo, LatencyStats, IcmpSource } from "../utils/speedTestUtils";

interface TechnicalLogsProps {
  clientInfo: ClientInfo | null;
  latencyStats: LatencyStats;
  icmpEstimate?: number;
  webrtcLatency?: number | null;
  icmpSource?: IcmpSource;
  icmpOffsetApplied?: number;
}

export default function TechnicalLogs({
  clientInfo,
  latencyStats,
  icmpEstimate,
  webrtcLatency = null,
  icmpSource = "http-fallback",
  icmpOffsetApplied = 0,
}: TechnicalLogsProps) {
  if (!clientInfo) return null;

  const httpRtt = latencyStats.avg;
  const hasHttpRtt = latencyStats.latencies.length > 0 && httpRtt > 0;
  const hasWebRtc = webrtcLatency !== null && webrtcLatency > 0;
  const hasIcmpEstimate = icmpEstimate !== undefined && icmpEstimate > 0;

  return (
    <details className="group border border-hairline rounded-lg overflow-hidden bg-canvas">
      <summary className="bg-canvas-soft-2 p-4 cursor-pointer text-xs font-mono text-mute select-none flex justify-between items-center hover:bg-canvas-soft-2/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset transition-colors duration-150">
        <span>SHOW TECHNICAL DETAIL LOGS</span>
        <span className="text-[10px] text-mute group-open:rotate-180 transition-transform duration-150" aria-hidden="true">
          ▼
        </span>
      </summary>
      <div className="p-5 border-t border-hairline grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-xs text-body font-mono">
        {/* YOUR CONNECTION */}
        <div className="flex flex-col gap-2 col-span-1">
          <span className="text-mute font-semibold">YOUR CONNECTION</span>
          <div className="tabular-nums">
            IP: <span className="text-ink">{clientInfo.ip}</span>
          </div>
          <div>
            ISP: <span className="text-ink">{clientInfo.org}</span>
          </div>
          <div>
            Location:{" "}
            <span className="text-ink">
              {clientInfo.city}, {clientInfo.region}, {clientInfo.country}
            </span>
            {clientInfo.isPrecise && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-success font-sans">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                GPS
                {clientInfo.gpsAccuracy != null && (
                  <span className="text-mute">({clientInfo.gpsAccuracy}m)</span>
                )}
              </span>
            )}
            {clientInfo.isApproximate && !clientInfo.isPrecise && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-warning font-sans">
                <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
                IP
              </span>
            )}
          </div>
          {clientInfo.connectionType && (
            <div>
              Connection:{" "}
              <span className="text-ink">{clientInfo.connectionType}</span>
              {clientInfo.effectiveType && (
                <span className="text-mute"> ({clientInfo.effectiveType})</span>
              )}
            </div>
          )}
        </div>

        {/* MEASUREMENT NODE */}
        <div className="flex flex-col gap-2 col-span-1">
          <span className="text-mute font-semibold">MEASUREMENT NODE</span>
          <div>
            Provider: <span className="text-ink">Cloudflare</span>
          </div>
          <div>
            Routing: <span className="text-ink">Anycast BGP (automatic)</span>
          </div>
          <div className="text-[10px] text-mute mt-2 leading-relaxed">
            Cloudflare routes to the optimal server via BGP.
            No manual server selection — path is determined by
            real-time network topology.
          </div>
          <div className="text-[10px] text-mute mt-2 leading-relaxed">
            <strong>Note on latency:</strong> Loaded latency measures HTTP-level RTT
            on the same TCP connection as data streams (HTTP/2 multiplexing).
            This reflects real-world latency during active usage, not ICMP ping.
          </div>
        </div>

        {/* LATENCY COMPARISON: HTTP RTT vs WebRTC STUN */}
        <div className="flex flex-col gap-3 col-span-full">
          <span className="text-mute font-semibold">LATENCY COMPARISON</span>

          <div className="grid grid-cols-2 gap-3">
            {/* HTTP RTT */}
            <div className="flex flex-col gap-1.5 border border-hairline rounded-md p-2.5 bg-canvas-soft">
              <span className="text-[10px] text-mute font-semibold uppercase">HTTP RTT (TCP)</span>
              {hasHttpRtt ? (
                <span className="text-lg font-bold text-ink tabular-nums">
                  {httpRtt.toFixed(1)}<span className="text-xs font-normal text-mute ml-0.5">ms</span>
                </span>
              ) : (
                <span className="text-lg font-bold text-mute tabular-nums">—</span>
              )}
              <span className="text-[10px] text-mute leading-tight">
                TCP + TLS 1.3 + HTTP/2 framing overhead
              </span>
            </div>

            {/* WebRTC Data Channel */}
            <div className="flex flex-col gap-1.5 border border-hairline rounded-md p-2.5 bg-canvas-soft">
              <span className="text-[10px] text-mute font-semibold uppercase">UDP RTT (WebRTC)</span>
              {hasWebRtc ? (
                <span className="text-lg font-bold text-ink tabular-nums">
                  {webrtcLatency!.toFixed(1)}<span className="text-xs font-normal text-mute ml-0.5">ms</span>
                </span>
              ) : (
                <span className="text-lg font-bold text-mute tabular-nums">—</span>
              )}
              <span className="text-[10px] text-mute leading-tight">
                UDP transport — no TCP/TLS/HTTP layers
              </span>
            </div>
          </div>

          {/* ICMP Estimate */}
          {hasIcmpEstimate && (
            <div className="flex flex-col gap-1 border-t border-hairline pt-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[10px] text-mute">Est. ICMP:</span>
                <span className="text-sm font-semibold text-ink tabular-nums">~{icmpEstimate!.toFixed(1)} ms</span>
                {icmpSource === "webrtc" ? (
                  <span className="text-[10px] text-[#0070f3]">(via WebRTC UDP)</span>
                ) : (
                  <span className="text-[10px] text-mute">(via HTTP -{icmpOffsetApplied}ms)</span>
                )}
              </div>
            </div>
          )}

          <div className="text-[10px] text-mute leading-relaxed mt-1">
            <strong>ICMP estimation method:</strong> Prefers WebRTC DataChannel echo RTT
            (UDP transport, bypasses TCP/TLS/HTTP overhead — closest to ICMP in browser).
            Falls back to HTTP RTT minus a fixed offset ({icmpOffsetApplied}ms) when WebRTC
            is unavailable (firewall, STUN blocked, permission denied). The offset accounts
            for TLS 1.3 + HTTP/2 framing overhead — a constant additive delay, not proportional to RTT.
          </div>
        </div>
      </div>
    </details>
  );
}
