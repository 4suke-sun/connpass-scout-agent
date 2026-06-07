import { describe, expect, it } from "vitest";
import type { ConnpassClient } from "../connpass/client.js";
import type { ConnpassEvent, ConnpassEventSearchParams, ConnpassEventSearchResult } from "../connpass/types.js";
import { createConnpassSearchTool } from "./connpass-search.js";

const SAMPLE_EVENT: ConnpassEvent = {
  id: 12345,
  title: "TypeScript勉強会",
  catchCopy: "型のある世界へようこそ",
  description: "<p>説明(HTML)</p>",
  url: "https://connpass.com/event/12345/",
  hashTag: "tsstudy",
  startedAt: "2026-06-10T19:00:00+09:00",
  endedAt: "2026-06-10T21:00:00+09:00",
  limit: 30,
  address: "東京都渋谷区",
  place: "オンライン",
  accepted: 20,
  waiting: 0,
};

function createFakeConnpassClient(result: ConnpassEventSearchResult): {
  client: ConnpassClient;
  calls: (ConnpassEventSearchParams | undefined)[];
} {
  const calls: (ConnpassEventSearchParams | undefined)[] = [];
  const client: ConnpassClient = {
    searchEvents: async (params) => {
      calls.push(params);
      return result;
    },
  };
  return { client, calls };
}

describe("createConnpassSearchTool", () => {
  it("キーワードを指定した場合_keyword検索パラメータへ変換してconnpassクライアントを呼び出す", async () => {
    const { client, calls } = createFakeConnpassClient({
      resultsStart: 1,
      resultsReturned: 1,
      resultsAvailable: 1,
      events: [SAMPLE_EVENT],
    });
    const searchTool = createConnpassSearchTool(client);

    await searchTool.invoke({ keywords: ["TypeScript", "#kanagawapy"] });

    expect(calls).toEqual([{ keyword: ["TypeScript", "#kanagawapy"], count: 10, order: 2 }]);
  });

  it("件数を指定した場合_その件数をconnpassクライアントへ渡す", async () => {
    const { client, calls } = createFakeConnpassClient({
      resultsStart: 0,
      resultsReturned: 0,
      resultsAvailable: 0,
      events: [],
    });
    const searchTool = createConnpassSearchTool(client);

    await searchTool.invoke({ keywords: ["AWS"], count: 5 });

    expect(calls).toEqual([{ keyword: ["AWS"], count: 5, order: 2 }]);
  });

  it("検索結果が返る場合_LLMが要約しやすい形にイベントを整形し説明文(HTML)は含めない", async () => {
    const { client } = createFakeConnpassClient({
      resultsStart: 1,
      resultsReturned: 1,
      resultsAvailable: 1,
      events: [SAMPLE_EVENT],
    });
    const searchTool = createConnpassSearchTool(client);

    const result = await searchTool.invoke({ keywords: ["TypeScript"] });

    expect(result).toEqual([
      {
        title: "TypeScript勉強会",
        catchCopy: "型のある世界へようこそ",
        url: "https://connpass.com/event/12345/",
        hashTag: "tsstudy",
        startedAt: "2026-06-10T19:00:00+09:00",
        endedAt: "2026-06-10T21:00:00+09:00",
        place: "オンライン",
        address: "東京都渋谷区",
        accepted: 20,
        limit: 30,
      },
    ]);
    for (const event of result as Record<string, unknown>[]) {
      expect(event).not.toHaveProperty("description");
    }
  });

  it("検索結果が0件の場合_空配列を返す", async () => {
    const { client } = createFakeConnpassClient({
      resultsStart: 0,
      resultsReturned: 0,
      resultsAvailable: 0,
      events: [],
    });
    const searchTool = createConnpassSearchTool(client);

    const result = await searchTool.invoke({ keywords: ["該当なしキーワード"] });

    expect(result).toEqual([]);
  });
});
