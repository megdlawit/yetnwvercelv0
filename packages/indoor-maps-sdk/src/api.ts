import type { IndoorMapGraph, IndoorMapRouteResult } from './types';

const DEFAULT_API_BASE_URL = 'https://utlrpeyplazojlwostor.supabase.co/functions/v1/indoor-maps-api';

export class IndoorMapApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IndoorMapApiError';
    this.status = status;
  }
}

export interface FetchGraphOptions {
  apiKey: string;
  buildingId: string;
  floor?: number;
  apiBaseUrl?: string;
  signal?: AbortSignal;
}

/**
 * Fetches a building's floor graph (nodes, paths, POIs) through the public
 * Edge Function. This is the *only* network call the SDK makes — it never
 * talks to Supabase's REST API or the anon key directly, so a partner's
 * bundle never contains anything that could read your raw tables.
 */
export async function fetchBuildingGraph({
  apiKey,
  buildingId,
  floor,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  signal,
}: FetchGraphOptions): Promise<IndoorMapGraph> {
  const url = new URL(`${apiBaseUrl}/buildings/${encodeURIComponent(buildingId)}/graph`);
  if (typeof floor === 'number') url.searchParams.set('floor', String(floor));

  const res = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey },
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new IndoorMapApiError(body.error ?? `Request failed with status ${res.status}`, res.status);
  }

  return res.json();
}

export interface FetchRouteOptions {
  apiKey: string;
  buildingId: string;
  /** Place (node) ids, e.g. from `graph.venue.floors[i].nodes`. */
  from: string;
  to: string;
  /** Avoid stairs and escalators (use lifts and ramps). */
  stepFree?: boolean;
  apiBaseUrl?: string;
  signal?: AbortSignal;
}

/**
 * Walking directions between two places, across floors if needed — the same
 * routing the visitor app uses, computed by the API.
 */
export async function fetchRoute({
  apiKey, buildingId, from, to, stepFree = false, apiBaseUrl = DEFAULT_API_BASE_URL, signal,
}: FetchRouteOptions): Promise<IndoorMapRouteResult> {
  const url = new URL(`${apiBaseUrl}/buildings/${encodeURIComponent(buildingId)}/route`);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  if (stepFree) url.searchParams.set('stepFree', '1');
  const res = await fetch(url.toString(), { headers: { 'x-api-key': apiKey }, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new IndoorMapApiError(body.error ?? `Request failed with status ${res.status}`, res.status);
  }
  return res.json();
}
