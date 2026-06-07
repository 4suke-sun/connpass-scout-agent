import { createThrottler, systemClock, type Throttle } from "./throttle.js";
import type { ConnpassEvent, ConnpassEventSearchParams, ConnpassEventSearchResult } from "./types.js";

const SEARCH_EVENTS_URL = "https://connpass.com/api/v2/events/";

/** connpass API v2 のレート制限 (1 req/sec) を遵守するための既定間隔 */
const RATE_LIMIT_INTERVAL_MS = 1000;

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>;

export interface ConnpassClientOptions {
  /** connpass API v2 のAPIキー。実際の値は環境変数や SSM 経由で渡し、ソースに書かない */
  apiKey: string;
  /** connpass API の利用規約で送信が求められる User-Agent */
  userAgent: string;
  fetch?: FetchLike;
  throttle?: Throttle;
}

export interface ConnpassClient {
  searchEvents(params?: ConnpassEventSearchParams): Promise<ConnpassEventSearchResult>;
}

export class ConnpassApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`connpass API がエラーを返しました (status=${status})`);
    this.name = "ConnpassApiError";
    this.status = status;
    this.body = body;
  }
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export function createConnpassClient(options: ConnpassClientOptions): ConnpassClient {
  const fetchImpl = options.fetch ?? defaultFetch;
  const throttle = options.throttle ?? createThrottler(RATE_LIMIT_INTERVAL_MS, systemClock);

  return {
    async searchEvents(params = {}): Promise<ConnpassEventSearchResult> {
      const url = buildSearchUrl(params);
      const response = await throttle(() =>
        fetchImpl(url, {
          headers: {
            "X-API-Key": options.apiKey,
            "User-Agent": options.userAgent,
          },
        }),
      );

      if (!response.ok) {
        throw new ConnpassApiError(response.status, await response.text());
      }

      return toSearchResult((await response.json()) as RawEventSearchResponse);
    },
  };
}

function buildSearchUrl(params: ConnpassEventSearchParams): string {
  const query = new URLSearchParams();
  appendAll(query, "keyword", params.keyword);
  appendAll(query, "keyword_or", params.keywordOr);
  appendAll(query, "ym", params.ym);
  appendAll(query, "ymd", params.ymd);
  appendAll(query, "nickname", params.nickname);
  appendAll(query, "owner_nickname", params.ownerNickname);
  appendAll(query, "series_id", params.seriesId?.map(String));
  appendAll(query, "event_id", params.eventId?.map(String));
  appendAll(query, "prefecture", params.prefecture);
  if (params.start !== undefined) {
    query.set("start", String(params.start));
  }
  if (params.count !== undefined) {
    query.set("count", String(params.count));
  }
  if (params.order !== undefined) {
    query.set("order", String(params.order));
  }

  const queryString = query.toString();
  return queryString ? `${SEARCH_EVENTS_URL}?${queryString}` : SEARCH_EVENTS_URL;
}

function appendAll(query: URLSearchParams, key: string, values: readonly string[] | undefined): void {
  for (const value of values ?? []) {
    query.append(key, value);
  }
}

interface RawConnpassEvent {
  event_id: number;
  title: string;
  catch: string;
  description: string;
  url: string;
  hash_tag: string;
  started_at: string;
  ended_at: string;
  limit: number | null;
  address: string | null;
  place: string | null;
  accepted: number;
  waiting: number;
}

interface RawEventSearchResponse {
  results_start: number;
  results_returned: number;
  results_available: number;
  events: RawConnpassEvent[];
}

function toSearchResult(raw: RawEventSearchResponse): ConnpassEventSearchResult {
  return {
    resultsStart: raw.results_start,
    resultsReturned: raw.results_returned,
    resultsAvailable: raw.results_available,
    events: raw.events.map(toEvent),
  };
}

function toEvent(raw: RawConnpassEvent): ConnpassEvent {
  return {
    id: raw.event_id,
    title: raw.title,
    catchCopy: raw.catch,
    description: raw.description,
    url: raw.url,
    hashTag: raw.hash_tag,
    startedAt: raw.started_at,
    endedAt: raw.ended_at,
    limit: raw.limit,
    address: raw.address,
    place: raw.place,
    accepted: raw.accepted,
    waiting: raw.waiting,
  };
}
