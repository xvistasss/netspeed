import type { ClientInfo, TestServer } from "../../utils/speedTestUtils";
import { haversineDistance } from "../../utils/speedTestUtils";

interface TechnicalLogsProps {
  clientInfo: ClientInfo | null;
  selectedServer: TestServer | null;
  routingResults: { [key: string]: number };
}

export default function TechnicalLogs({
  clientInfo,
  selectedServer,
  routingResults,
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
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-mute font-semibold">MEASUREMENT NODE INFO</span>
          <div>
            Node:{" "}
            <span className="text-ink">
              {selectedServer?.name || "Evaluating…"}
            </span>
          </div>
          <div>
            Endpoint:{" "}
            <span className="text-ink">
              {window.location.origin}/api
            </span>
          </div>
          <div>
            Region Param:{" "}
            <span className="text-ink">
              {selectedServer?.region
                ? `?region=${selectedServer.region}`
                : "(none)"}
            </span>
          </div>
          {selectedServer &&
            clientInfo.latitude !== 0 && (
              <div className="tabular-nums">
                Est. Distance:{" "}
                <span className="text-ink">
                  {Math.round(
                    haversineDistance(
                      clientInfo.latitude,
                      clientInfo.longitude,
                      selectedServer.lat,
                      selectedServer.lon,
                    ),
                  )}{" "}
                  km
                </span>
              </div>
            )}
          <div className="tabular-nums">
            Pre-Ping Latency:{" "}
            <span className="text-ink">
              {routingResults[selectedServer?.id || ""]
                ? `${Math.round(routingResults[selectedServer?.id || ""])}ms`
                : "Not pinged"}
            </span>
          </div>
        </div>
      </div>
    </details>
  );
}
