import { useState, useRef, useCallback, useEffect } from "react";
import type { ClientInfo } from "../types";
import {
  fetchReverseGeocode,
  fetchIpLocation,
  readNetworkInformation,
  isGpsSuspicious,
} from "../utils/geoService";
import { haversineDistance } from "../utils/serverSelection";

interface UseGeolocationOptions {
  appendLogs: (lines: string[]) => void;
  setStatusMessage: (msg: string) => void;
}

export function useGeolocation({ appendLogs, setStatusMessage }: UseGeolocationOptions) {
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const clientInfoRef = useRef<ClientInfo | null>(null);

  const [locationPrePromptWaiting, setLocationPrePromptWaiting] = useState(false);
  const [locationPrePromptTimeLeft, setLocationPrePromptTimeLeft] = useState<number | null>(null);

  const locationResolveRef = useRef<((value: { latitude: number; longitude: number; accuracy: number } | null) => void) | null>(null);
  const locationActionRef = useRef<"allow" | "skip" | null>(null);
  const locationPrePromptTimerRef = useRef<number | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);

  const skipLocationPrompt = useCallback(() => {
    if (locationPrePromptTimerRef.current) {
      clearInterval(locationPrePromptTimerRef.current);
      locationPrePromptTimerRef.current = null;
    }
    if (geoWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
    }
    setLocationPrePromptWaiting(false);
    setLocationPrePromptTimeLeft(null);
    locationActionRef.current = "skip";
    if (locationResolveRef.current) {
      appendLogs(["[INFO] Location permission request skipped by user. Using approximate location."]);
      locationResolveRef.current(null);
      locationResolveRef.current = null;
    }
  }, [appendLogs]);

  const allowLocationPrompt = useCallback(() => {
    if (locationPrePromptTimerRef.current) {
      clearInterval(locationPrePromptTimerRef.current);
      locationPrePromptTimerRef.current = null;
    }
    setLocationPrePromptWaiting(false);
    setLocationPrePromptTimeLeft(null);
    locationActionRef.current = "allow";
  }, []);

  const resetLocationPrompt = useCallback(() => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("location-prompt-dismissed");
    }
    appendLogs(["[INFO] Location prompt reset. GPS will be offered on next test."]);
  }, [appendLogs]);

  const getPreciseCoords = useCallback((): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
    return new Promise(async (resolve) => {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }

      const cancelGeoWatch = () => {
        if (geoWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(geoWatchIdRef.current);
          geoWatchIdRef.current = null;
        }
      };

      const requestGeoPosition = () => {
        const attempt = (enableHighAccuracy: boolean, retries: number, delayMs: number) => {
          cancelGeoWatch();

          geoWatchIdRef.current = navigator.geolocation.watchPosition(
            (position) => {
              cancelGeoWatch();
              if (locationResolveRef.current === resolve) {
                if (enableHighAccuracy && position.coords.accuracy > 100) {
                  appendLogs([
                    `[WARN] GPS accuracy ${position.coords.accuracy.toFixed(0)}m is too low (threshold: 100m). Retrying with low-accuracy mode.`,
                  ]);
                  attempt(false, 0, 200);
                  return;
                }
                if (!enableHighAccuracy && position.coords.accuracy > 1000) {
                  appendLogs([
                    `[WARN] Location accuracy ${position.coords.accuracy.toFixed(0)}m is too unreliable (>1km). Falling back to IP-based location.`,
                  ]);
                  cancelGeoWatch();
                  resolve(null);
                  locationResolveRef.current = null;
                  return;
                }
                const label = enableHighAccuracy ? "High-accuracy" : "Low-accuracy";
                const accuracy = Math.round(position.coords.accuracy);
                appendLogs([`[INFO] ${label} geolocation obtained from device (accuracy: ${accuracy}m).`]);
                resolve({
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  accuracy,
                });
                locationResolveRef.current = null;
              }
            },
            (error) => {
              if (locationResolveRef.current !== resolve) return;
              cancelGeoWatch();

              if (error.code === error.PERMISSION_DENIED) {
                if (typeof window !== "undefined") {
                  sessionStorage.setItem("location-prompt-dismissed", "true");
                }
                resolve(null);
                locationResolveRef.current = null;
                return;
              }

              if (retries > 0 && enableHighAccuracy) {
                setTimeout(() => {
                  if (locationResolveRef.current === resolve) {
                    attempt(enableHighAccuracy, retries - 1, delayMs * 2);
                  }
                }, delayMs);
              } else if (enableHighAccuracy) {
                attempt(false, 0, 200);
              } else {
                if (typeof window !== "undefined") {
                  sessionStorage.setItem("location-prompt-dismissed", "true");
                }
                resolve(null);
                locationResolveRef.current = null;
              }
            },
            { enableHighAccuracy, maximumAge: enableHighAccuracy ? 300000 : 600000 },
          );
        };

        appendLogs(["[INFO] Requesting browser geolocation..."]);
        attempt(true, 3, 500);
      };

      let permissionState: PermissionState | null = null;
      let permissionStatus: PermissionStatus | null = null;
      if (typeof navigator !== "undefined" && navigator.permissions) {
        try {
          const result = await navigator.permissions.query({ name: "geolocation" as PermissionName });
          permissionState = result.state;
          permissionStatus = result;
        } catch (_) {}
      }

      if (permissionState === "denied") {
        appendLogs(["[INFO] Geolocation permission is denied. Using approximate location."]);
        if (typeof window !== "undefined") {
          sessionStorage.setItem("location-prompt-dismissed", "true");
        }
        resolve(null);
        return;
      }

      if (permissionState === "granted") {
        locationResolveRef.current = resolve;
        appendLogs(["[INFO] Geolocation permission granted. Requesting GPS coordinates..."]);
        requestGeoPosition();
        return;
      }

      locationResolveRef.current = resolve;
      locationActionRef.current = null;
      setLocationPrePromptWaiting(true);
      setLocationPrePromptTimeLeft(10);
      appendLogs(["[INFO] Location permission not yet decided. Awaiting user response..."]);

      let timeLeft = 10;
      locationPrePromptTimerRef.current = window.setInterval(() => {
        timeLeft -= 1;
        if (timeLeft <= 0) {
          if (locationPrePromptTimerRef.current) {
            clearInterval(locationPrePromptTimerRef.current);
            locationPrePromptTimerRef.current = null;
          }
          setLocationPrePromptTimeLeft(null);
          if (locationResolveRef.current === resolve) {
            appendLogs(["[WARN] Location pre-prompt timed out. Using approximate location."]);
            setLocationPrePromptWaiting(false);
            locationResolveRef.current(null);
            locationResolveRef.current = null;
          }
        } else {
          setLocationPrePromptTimeLeft(timeLeft);
        }
      }, 1000);

      if (permissionStatus) {
        permissionStatus.onchange = () => {
          if (permissionStatus!.state === "denied" && locationResolveRef.current === resolve) {
            cancelGeoWatch();
            if (locationPrePromptTimerRef.current) {
              clearInterval(locationPrePromptTimerRef.current);
              locationPrePromptTimerRef.current = null;
            }
            setLocationPrePromptWaiting(false);
            setLocationPrePromptTimeLeft(null);
            if (typeof window !== "undefined") {
              sessionStorage.setItem("location-prompt-dismissed", "true");
            }
            appendLogs(["[INFO] Geolocation permission denied by user."]);
            resolve(null);
            locationResolveRef.current = null;
          }
        };
      }

      const pollInterval = setInterval(() => {
        const action = locationActionRef.current;
        if (action === null) return;

        clearInterval(pollInterval);
        locationActionRef.current = null;

        if (action === "allow") {
          appendLogs(["[INFO] User granted location access. Starting geolocation request..."]);
          requestGeoPosition();
        }
      }, 50);
    });
  }, [appendLogs]);

  const upgradeToPreciseLocation = useCallback(async (): Promise<ClientInfo | null> => {
    const coords = await getPreciseCoords();
    if (!coords) return null;
    const { city: gpsCity, region: gpsRegion, countryCode } = await fetchReverseGeocode(
      coords.latitude,
      coords.longitude,
    );

    let url = `/api/ip-geo?clientLat=${coords.latitude}&clientLon=${coords.longitude}`;
    if (gpsCity) url += `&city=${encodeURIComponent(gpsCity)}`;
    if (gpsRegion) url += `&region=${encodeURIComponent(gpsRegion)}`;
    if (countryCode) url += `&countryCode=${encodeURIComponent(countryCode)}`;

    try {
      const geoRes = await fetch(url, { cache: "no-store" });
      if (geoRes.ok) {
        const data = await geoRes.json();
        const existing = clientInfoRef.current;
        if (!existing) return null;

        if (isGpsSuspicious(coords, existing, countryCode)) {
          const distFromIp = haversineDistance(
            coords.latitude,
            coords.longitude,
            existing.latitude,
            existing.longitude,
          );
          appendLogs([
            `[WARN] Low-accuracy GPS (${coords.accuracy}m) is ${Math.round(distFromIp)}km from IP location (GPS: ${gpsCity || "?"}, IP: ${existing.city || "?"}).`,
            `[WARN] GPS may be stale WiFi-based position. Keeping IP-based location.`,
          ]);
          return existing;
        }

        if (coords.accuracy > 200) {
          appendLogs([`[INFO] Accepting GPS with accuracy ${coords.accuracy}m (within same country as IP).`]);
        }

        const preciseData: ClientInfo = {
          ...existing,
          city: data.city || existing.city,
          region: data.region || existing.region,
          country: data.country || existing.country,
          latitude: coords.latitude,
          longitude: coords.longitude,
          gpsAccuracy: coords.accuracy,
          isPrecise: true,
          isApproximate: false,
        };
        setClientInfo(preciseData);
        clientInfoRef.current = preciseData;
        setStatusMessage(`Precise location loaded: ${preciseData.city}, ${preciseData.country}`);
        appendLogs([
          `[OK] Precise location: ${preciseData.city}, ${preciseData.region}, ${preciseData.country} (accuracy: ${coords.accuracy}m)`,
        ]);
        return preciseData;
      }
    } catch (e) {
      console.warn("Precise location upgrade failed:", e);
    }
    return null;
  }, [getPreciseCoords, appendLogs, setStatusMessage]);

  const detectClientLocation = useCallback(async (): Promise<ClientInfo | null> => {
    try {
      const alreadyPrecise = clientInfoRef.current?.isPrecise;
      if (!alreadyPrecise) {
        setStatusMessage("Detecting location...");
      }

      const data = await fetchIpLocation();
      const existing = clientInfoRef.current;
      const initialData: ClientInfo = existing?.isPrecise
        ? {
            ...data,
            isPrecise: true,
            isApproximate: false,
            city: existing.city,
            region: existing.region,
            country: existing.country,
            latitude: existing.latitude,
            longitude: existing.longitude,
          }
        : { ...data, isPrecise: false, isApproximate: true };

      const netInfo = readNetworkInformation();
      Object.assign(initialData, netInfo);

      if (initialData.connectionType) {
        appendLogs(
          [
            `[INFO] Connection: ${initialData.connectionType || "unknown"} (${initialData.effectiveType || "N/A"})`,
            initialData.downlink ? `[INFO] Estimated downlink: ${initialData.downlink} Mbps` : "",
            initialData.rtt ? `[INFO] Network RTT: ${initialData.rtt} ms` : "",
          ].filter(Boolean),
        );
      }

      setClientInfo(initialData);
      clientInfoRef.current = initialData;
      setStatusMessage(`Client IP detected: ${initialData.ip}`);
      return initialData;
    } catch (err) {
      const defaultData: ClientInfo = {
        ip: "0.0.0.0",
        city: "Unknown",
        region: "Unknown",
        country: "Unknown",
        org: "Unknown",
        latitude: 0,
        longitude: 0,
        isLocal: false,
        isPrecise: false,
        isApproximate: true,
      };
      console.error("Failed to locate client:", err);
      setStatusMessage("GeoIP detection failed. Using global defaults.");
      setClientInfo(defaultData);
      clientInfoRef.current = defaultData;
      return defaultData;
    }
  }, [appendLogs, setStatusMessage]);

  useEffect(() => {
    return () => {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
      if (locationPrePromptTimerRef.current) {
        clearInterval(locationPrePromptTimerRef.current);
        locationPrePromptTimerRef.current = null;
      }
    };
  }, []);

  return {
    clientInfo,
    setClientInfo,
    clientInfoRef,
    locationPrePromptWaiting,
    locationPrePromptTimeLeft,
    skipLocationPrompt,
    allowLocationPrompt,
    resetLocationPrompt,
    detectClientLocation,
    upgradeToPreciseLocation,
  };
}
