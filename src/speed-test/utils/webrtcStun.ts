import { CONFIG } from "../constants";
import { calculateTrimmedMean } from "./mathStats";

/**
 * WebRTC Telemetry Reference
 *
 * NOTE: Standard browser WebRTC requires a remote signaling peer to measure
 * real over-the-network UDP round-trip times. In-browser loopback connects
 * host ICE candidates locally. True Layer-3 ICMP is restricted by web security sandboxes;
 * therefore, edge telemetry uses HTTP RTT calibrated with dynamic transport framing offsets.
 */
export async function measureWebRTCSTUN(
  timeoutMs: number = CONFIG.WEBRTC_TIMEOUT_MS,
): Promise<number | null> {
  if (typeof RTCPeerConnection === "undefined") return null;

  try {
    const pc1 = new RTCPeerConnection({
      iceServers: [...CONFIG.STUN_SERVERS],
    });
    const pc2 = new RTCPeerConnection({
      iceServers: [...CONFIG.STUN_SERVERS],
    });

    pc1.onicecandidate = (e) => {
      if (e.candidate) pc2.addIceCandidate(e.candidate).catch(() => {});
    };
    pc2.onicecandidate = (e) => {
      if (e.candidate) pc1.addIceCandidate(e.candidate).catch(() => {});
    };

    const dc = pc1.createDataChannel("echo");

    const dcOpenPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Data channel open timeout")), timeoutMs);
      pc2.ondatachannel = (e) => {
        const remoteDc = e.channel;
        remoteDc.onmessage = (ev) => {
          try {
            remoteDc.send(ev.data);
          } catch (_) {}
        };
      };
      dc.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(pc1.localDescription!);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(pc2.localDescription!);

    await dcOpenPromise;

    const rtts: number[] = [];
    for (let i = 0; i < CONFIG.WEBRTC_PING_COUNT; i++) {
      const rtt = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Echo timeout")),
          CONFIG.WEBRTC_ECHO_TIMEOUT_MS,
        );
        dc.onmessage = () => {
          clearTimeout(timer);
          resolve(performance.now() - pingStart);
        };
        const pingStart = performance.now();
        dc.send("ping");
      });
      rtts.push(rtt);
      await new Promise((r) => setTimeout(r, CONFIG.WEBRTC_PING_INTERVAL_MS));
    }

    dc.close();
    pc1.close();
    pc2.close();

    return calculateTrimmedMean(rtts, 0.1);
  } catch (_) {
    return null;
  }
}
