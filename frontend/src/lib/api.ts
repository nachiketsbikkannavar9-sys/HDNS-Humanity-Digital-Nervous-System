const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:4000" : "");

export const API_BASE = BASE;
export const TOKEN_KEY = "hdns_auth";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getAuthUser(): {
  id: string;
  email: string;
  role: string;
  displayName: string;
  jurisdictionRegions: string[];
  jurisdictionStationIds: string[];
} | null {
  try {
    return JSON.parse(localStorage.getItem("hdns_user") ?? "null");
  } catch {
    return null;
  }
}
export function setAuthUser(user: unknown) {
  if (user) localStorage.setItem("hdns_user", JSON.stringify(user));
  else localStorage.removeItem("hdns_user");
}

import {
  FALLBACK_ALERTS,
  FALLBACK_STATIONS,
  getFallbackExposure,
  getFallbackHistory,
  getFallbackStats,
} from "./fallbackData";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    const isGet = !init.method || init.method.toUpperCase() === "GET";
    if (isGet) {
      const cleanPath = path.split("?")[0];
      if (cleanPath === "/api/stations") {
        return { stations: FALLBACK_STATIONS, stats: getFallbackStats() } as T;
      }
      if (cleanPath.startsWith("/api/stations/") && cleanPath.endsWith("/history")) {
        const parts = cleanPath.split("/");
        const stationId = parts[3];
        const hours = Number(new URLSearchParams(path.split("?")[1] ?? "").get("hours") ?? 24);
        return getFallbackHistory(stationId, hours) as T;
      }
      if (cleanPath.startsWith("/api/stations/")) {
        const stationId = cleanPath.replace("/api/stations/", "");
        const station = FALLBACK_STATIONS.find((s) => s.id === stationId || s.externalId === stationId) ?? FALLBACK_STATIONS[0];
        return { station } as T;
      }
      if (cleanPath === "/api/alerts") {
        return { alerts: FALLBACK_ALERTS } as T;
      }
      if (cleanPath === "/api/alerts/stats") {
        return { stats: getFallbackStats() } as T;
      }
      if (cleanPath === "/api/alerts/contacts") {
        return {
          contacts: [
            { name: "NDRF Control Room (Demo)", role: "NDRF/DDMA demo list", channel: "email", address: "ndrf@demo.local" },
          ],
        } as T;
      }
      if (cleanPath === "/api/location/exposure") {
        const urlParams = new URLSearchParams(path.split("?")[1] ?? "");
        const lat = Number(urlParams.get("lat") ?? 26.18);
        const lng = Number(urlParams.get("lng") ?? 91.73);
        return getFallbackExposure(lat, lng) as T;
      }
      if (cleanPath === "/api/location/demo") {
        return {
          station: { id: "fb-brahmaputra", name: "Brahmaputra at Guwahati", place: "Guwahati, Assam" },
          low: {
            lat: 26.183,
            lng: 91.731,
            label: "Demo · low ground beside the river",
            category: "Warning",
            score: 68,
          },
          raised: {
            lat: 26.195,
            lng: 91.752,
            label: "Demo · raised ground, same gauge",
            category: "Normal",
            score: 22,
          },
          crossedBands: true,
          lowDistanceKm: 0.8,
          withinLocalRangeKm: 50,
          generatedAt: new Date().toISOString(),
        } as T;
      }
      if (cleanPath === "/api/subscribe") {
        return {
          email: "demo@citizen.local",
          watching: "Assam",
          subscribedAt: new Date().toISOString(),
          active: true,
        } as T;
      }
    } else {
      // POST fallback for demo actions when offline
      if (path.includes("/acknowledge")) {
        const alertId = path.split("/")[3];
        const alert = FALLBACK_ALERTS.find((a) => a.id === alertId) ?? FALLBACK_ALERTS[0];
        return {
          alert: {
            ...alert,
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: "NDRF Control Room (Demo)",
          },
        } as T;
      }
      if (path === "/api/admin/simulate") {
        return {
          ok: true,
          alerts: 1,
          stationId: "fb-brahmaputra",
          note: "Demo mode: simulated spike triggered successfully.",
        } as T;
      }
      if (path === "/api/admin/trend") {
        return {
          note: "Demo mode: trend adjustment simulated.",
          stationId: "fb-brahmaputra",
        } as T;
      }
      if (path === "/api/subscribe") {
        return {
          subscribed: true,
          subscription: {
            email: "demo@citizen.local",
            watching: "Assam",
            unsubscribeUrl: "#",
          },
        } as T;
      }
      if (path === "/api/subscribe/unsubscribe") {
        return {
          unsubscribed: true,
          email: "demo@citizen.local",
        } as T;
      }
      if (path === "/api/auth/login") {
        const bodyObj = (typeof init.body === "string" ? JSON.parse(init.body) : init.body) ?? {};
        const email = String(bodyObj.email ?? "").toLowerCase();
        let user = {
          id: "auth-ndrf",
          email: "ndrf@demo.local",
          role: "admin",
          displayName: "NDRF Control Room (Demo)",
          jurisdictionRegions: [] as string[],
          jurisdictionStationIds: [] as string[],
        };
        if (email.includes("assam")) {
          user = {
            id: "auth-assam",
            email: "assam-sdma@demo.local",
            role: "district_officer",
            displayName: "Assam SDMA (Demo)",
            jurisdictionRegions: ["Assam"],
            jurisdictionStationIds: [],
          };
        } else if (email.includes("bihar")) {
          user = {
            id: "auth-bihar",
            email: "bihar-sdma@demo.local",
            role: "district_officer",
            displayName: "Bihar SDMA (Demo)",
            jurisdictionRegions: ["Bihar"],
            jurisdictionStationIds: [],
          };
        }
        return { token: "demo-jwt-token", user } as T;
      }
    }
    if (path.startsWith("/api/auth/me")) {
      const user = getAuthUser();
      return { user } as T;
    }
    throw err;
  }
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });