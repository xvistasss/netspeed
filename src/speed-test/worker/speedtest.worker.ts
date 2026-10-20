import { CONFIG } from "../constants";
import { runPingTest } from "./runners/pingRunner";
import { runDownloadTest } from "./runners/downloadRunner";
import { runUploadTest } from "./runners/uploadRunner";
import { runPacketLossTest } from "./runners/packetLossRunner";

/**
 * Network Speed Test Web Worker Engine
 * Dispatches test phases off the main thread to dedicated runners.
 */

let activeAbortController: AbortController | null = null;
let isCancelled = false;

const isCancelledCheck = () => isCancelled;
const post = (msg: any) => self.postMessage(msg);

function mapErrorMessage(error: any): string {
  const msg = error?.message || "";
  if (msg.includes("DNS") || msg.includes("resolve")) {
    return "DNS resolution failed - check your internet connection";
  }
  if (msg.includes("timeout") || error?.name === "TimeoutError") {
    return "Request timed out - network may be congested or unreachable";
  }
  if (msg.includes("429") || msg.includes("rate limit")) {
    return "Rate limited by server - retrying may help";
  }
  if (msg.includes("ECONNRESET") || msg.includes("reset")) {
    return "Connection reset by server - network instability detected";
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Network error - check your connection and firewall settings";
  }
  if (msg.includes("CORS") || msg.includes("cors")) {
    return "CORS error - direct connection blocked, falling back to proxy";
  }
  if (msg.includes("AbortError") || error?.name === "AbortError") {
    return "Request aborted - test may have been cancelled or timed out";
  }
  return msg || "An error occurred during testing";
}

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "CANCEL") {
    isCancelled = true;
    if (activeAbortController) {
      activeAbortController.abort();
    }
    self.postMessage({ type: "CANCELLED" });
    return;
  }

  isCancelled = false;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    if (type === "START_PING") {
      const { baseUrl, region, serverId, clientLat, clientLon, networkType } = e.data;
      await runPingTest({
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        networkType,
        signal,
        postMessage: post,
        isCancelled: isCancelledCheck,
      });
    } else if (type === "START_DOWNLOAD") {
      const {
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        dynamicWarmupMs,
        dynamicRampMs,
        networkType,
      } = e.data;
      await runDownloadTest({
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams: CONFIG.PARALLEL_STREAMS_DEFAULT,
        dynamicWarmupMs: dynamicWarmupMs || CONFIG.DOWNLOAD_WARMUP_MS,
        dynamicRampMs: dynamicRampMs || CONFIG.DOWNLOAD_RAMP_MS,
        networkType,
        signal,
        postMessage: post,
        isCancelled: isCancelledCheck,
      });
    } else if (type === "START_UPLOAD") {
      const {
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams,
        downloadSpeed,
        dynamicWarmupMs,
        dynamicRampMs,
        networkType,
      } = e.data;
      await runUploadTest({
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        basePing,
        parallelStreams: parallelStreams || CONFIG.PARALLEL_STREAMS_DEFAULT,
        downloadSpeed: downloadSpeed || 0,
        dynamicWarmupMs: dynamicWarmupMs || CONFIG.UPLOAD_WARMUP_MS,
        dynamicRampMs: dynamicRampMs || CONFIG.UPLOAD_RAMP_MS,
        networkType,
        signal,
        postMessage: post,
        isCancelled: isCancelledCheck,
      });
    } else if (type === "START_PACKET_LOSS") {
      const { baseUrl, region, serverId, clientLat, clientLon, networkType } = e.data;
      await runPacketLossTest({
        baseUrl,
        region,
        serverId,
        clientLat,
        clientLon,
        networkType,
        signal,
        postMessage: post,
        isCancelled: isCancelledCheck,
      });
    }
  } catch (error: any) {
    if (error?.name === "AbortError" || isCancelled) {
      return;
    }
    self.postMessage({
      type: "ERROR",
      message: mapErrorMessage(error),
    });
  }
};
