import { describe, expect, it } from "vitest";
import { ConnpassApiError, createConnpassClient, type FetchLike, type HttpResponse } from "./client.js";

const DUMMY_API_KEY = "dummy-connpass-api-key";
const DUMMY_USER_AGENT = "connpass-scout-agent/0.1 (+https://github.com/example/connpass-scout-agent)";

const EMPTY_RAW_RESPONSE = {
  results_start: 0,
  results_returned: 0,
  results_available: 0,
  events: [],
};

const SAMPLE_RAW_RESPONSE = {
  results_start: 1,
  results_returned: 1,
  results_available: 1,
  events: [
    {
      event_id: 12345,
      title: "TypeScript勉強会",
      catch: "型のある世界へようこそ",
      description: "<p>説明</p>",
      url: "https://connpass.com/event/12345/",
      hash_tag: "tsstudy",
      started_at: "2026-06-10T19:00:00+09:00",
      ended_at: "2026-06-10T21:00:00+09:00",
      limit: 30,
      address: "東京都渋谷区",
      place: "オンライン",
      accepted: 20,
      waiting: 0,
    },
  ],
};

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function createFakeFetch(response: HttpResponse): {
  fetch: FetchLike;
  calls: { url: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return response;
  };
  return { fetch, calls };
}

const noopThrottle = async <T>(task: () => Promise<T>): Promise<T> => task();

describe("createConnpassClient.searchEvents", () => {
  it("検索結果が返る場合_スネークケースのレスポンスをキャメルケースの型へ変換する", async () => {
    const { fetch } = createFakeFetch(jsonResponse(200, SAMPLE_RAW_RESPONSE));
    const client = createConnpassClient({
      apiKey: DUMMY_API_KEY,
      userAgent: DUMMY_USER_AGENT,
      fetch,
      throttle: noopThrottle,
    });

    const result = await client.searchEvents({ keyword: ["TypeScript"] });

    expect(result).toEqual({
      resultsStart: 1,
      resultsReturned: 1,
      resultsAvailable: 1,
      events: [
        {
          id: 12345,
          title: "TypeScript勉強会",
          catchCopy: "型のある世界へようこそ",
          description: "<p>説明</p>",
          url: "https://connpass.com/event/12345/",
          hashTag: "tsstudy",
          startedAt: "2026-06-10T19:00:00+09:00",
          endedAt: "2026-06-10T21:00:00+09:00",
          limit: 30,
          address: "東京都渋谷区",
          place: "オンライン",
          accepted: 20,
          waiting: 0,
        },
      ],
    });
  });

  it("検索条件を指定した場合_必須ヘッダと配列クエリパラメータを付与してリクエストする", async () => {
    const { fetch, calls } = createFakeFetch(jsonResponse(200, EMPTY_RAW_RESPONSE));
    const client = createConnpassClient({
      apiKey: DUMMY_API_KEY,
      userAgent: DUMMY_USER_AGENT,
      fetch,
      throttle: noopThrottle,
    });

    await client.searchEvents({
      keyword: ["TypeScript", "AWS"],
      ymd: ["20260610"],
      prefecture: ["tokyo"],
      count: 10,
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.headers).toEqual({ "X-API-Key": DUMMY_API_KEY, "User-Agent": DUMMY_USER_AGENT });

    const url = new URL(call?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://connpass.com/api/v2/events/");
    expect(url.searchParams.getAll("keyword")).toEqual(["TypeScript", "AWS"]);
    expect(url.searchParams.getAll("ymd")).toEqual(["20260610"]);
    expect(url.searchParams.getAll("prefecture")).toEqual(["tokyo"]);
    expect(url.searchParams.get("count")).toBe("10");
  });

  it("検索条件を指定しない場合_クエリパラメータなしでリクエストする", async () => {
    const { fetch, calls } = createFakeFetch(jsonResponse(200, EMPTY_RAW_RESPONSE));
    const client = createConnpassClient({
      apiKey: DUMMY_API_KEY,
      userAgent: DUMMY_USER_AGENT,
      fetch,
      throttle: noopThrottle,
    });

    await client.searchEvents();

    expect(calls[0]?.url).toBe("https://connpass.com/api/v2/events/");
  });

  it("APIがエラーレスポンスを返した場合_ConnpassApiErrorを送出する", async () => {
    const { fetch } = createFakeFetch(jsonResponse(429, { message: "Too Many Requests" }));
    const client = createConnpassClient({
      apiKey: DUMMY_API_KEY,
      userAgent: DUMMY_USER_AGENT,
      fetch,
      throttle: noopThrottle,
    });

    await expect(client.searchEvents()).rejects.toThrow(ConnpassApiError);
  });

  it("リクエストごとにスロットラーを介してfetchを実行する", async () => {
    const { fetch } = createFakeFetch(jsonResponse(200, EMPTY_RAW_RESPONSE));
    const throttleCalls: number[] = [];
    const throttle = async <T>(task: () => Promise<T>): Promise<T> => {
      throttleCalls.push(throttleCalls.length + 1);
      return task();
    };
    const client = createConnpassClient({ apiKey: DUMMY_API_KEY, userAgent: DUMMY_USER_AGENT, fetch, throttle });

    await client.searchEvents();
    await client.searchEvents();

    expect(throttleCalls).toEqual([1, 2]);
  });
});
