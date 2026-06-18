import type { ClientInfo } from "../../utils/speedTestUtils";

interface TechnicalLogsProps {
  clientInfo: ClientInfo | null;
}

export default function TechnicalLogs({
  clientInfo,
}: TechnicalLogsProps) {
  if (!clientInfo) return null;

  return (
    <details className="group border border-hairline rounded-lg overflow-hidden bg-canvas">
      <summary className="bg-canvas-soft-2 p-4 cursor-pointer text-xs font-mono text-mute select-none flex justify-between items-center hover:bg-canvas-soft-2/80 transition-colors duration-150">
        <span>SHOW TECHNICAL DETAIL LOGS</span>
        <span className="text-[10px] text-mute group-open:rotate-180 transition-transform duration-150">
          ▼
        </span>
      </summary>
      <div className="p-5 border-t border-hairline flex flex-col md:flex-row justify-between gap-6 text-xs text-body font-mono">
        <div className="flex flex-col gap-2">
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
          {clientInfo.downlink && (
            <div className="tabular-nums">
              Est. Downlink:{" "}
              <span className="text-ink">{clientInfo.downlink} Mbps</span>
            </div>
          )}
          {clientInfo.rtt && (
            <div className="tabular-nums">
              Network RTT:{" "}
              <span className="text-ink">{clientInfo.rtt} ms</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-mute font-semibold">MEASUREMENT NODE</span>
          <div>
            Provider: <span className="text-ink">Cloudflare</span>
          </div>
          <div>
            Routing: <span className="text-ink">Anycast BGP (automatic)</span>
          </div>
          <div>
            Endpoint:{" "}
            <span className="text-ink">
              {window.location.origin}/api
            </span>
          </div>
          <div className="text-[10px] text-mute mt-2 leading-relaxed">
            Cloudflare routes to the nearest edge via BGP.
            No manual server selection — path is determined by
            real-time network topology.
          </div>
        </div>
      </div>
    </details>
  );
}
