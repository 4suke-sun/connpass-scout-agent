import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import type { ConnpassClient } from "../connpass/client.js";
import type { ConnpassEvent } from "../connpass/types.js";

const DEFAULT_SEARCH_COUNT = 10;

/** 開催日時順 (近い開催が先頭に来る) */
const ORDER_BY_STARTED_AT = 2;

export const connpassSearchInputSchema = z.object({
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .describe('検索したいキーワードやハッシュタグの文字列配列(AND検索)。例: ["TypeScript", "#kanagawapy"]'),
  count: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(`取得する最大件数(省略時は ${DEFAULT_SEARCH_COUNT}, 最大100)`),
});

export type ConnpassSearchInput = z.infer<typeof connpassSearchInputSchema>;

/** LLM が要約しやすいよう、HTML を含む description 等を除いた最小限のイベント情報 */
export type ConnpassSearchDigestEvent = {
  title: string;
  catchCopy: string;
  url: string;
  hashTag: string;
  startedAt: string;
  endedAt: string;
  place: string | null;
  address: string | null;
  accepted: number;
  limit: number | null;
};

export function createConnpassSearchTool(client: ConnpassClient) {
  return tool({
    name: "search_connpass_events",
    description:
      "connpass からキーワードやハッシュタグに合致する技術コミュニティイベントを検索する。" +
      "結果は開催日時が近い順に返る。",
    inputSchema: connpassSearchInputSchema,
    callback: async (input: ConnpassSearchInput): Promise<ConnpassSearchDigestEvent[]> => {
      const result = await client.searchEvents({
        keyword: input.keywords,
        count: input.count ?? DEFAULT_SEARCH_COUNT,
        order: ORDER_BY_STARTED_AT,
      });
      return result.events.map(toDigestEvent);
    },
  });
}

function toDigestEvent(event: ConnpassEvent): ConnpassSearchDigestEvent {
  return {
    title: event.title,
    catchCopy: event.catchCopy,
    url: event.url,
    hashTag: event.hashTag,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    place: event.place,
    address: event.address,
    accepted: event.accepted,
    limit: event.limit,
  };
}
