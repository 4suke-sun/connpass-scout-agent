/** 検索結果の並び順。1: 更新日時順, 2: 開催日時順, 3: 新着順 */
export type ConnpassEventOrder = 1 | 2 | 3;

export interface ConnpassEventSearchParams {
  keyword?: readonly string[];
  keywordOr?: readonly string[];
  ym?: readonly string[];
  ymd?: readonly string[];
  nickname?: readonly string[];
  ownerNickname?: readonly string[];
  seriesId?: readonly number[];
  eventId?: readonly number[];
  prefecture?: readonly string[];
  start?: number;
  count?: number;
  order?: ConnpassEventOrder;
}

export interface ConnpassEvent {
  id: number;
  title: string;
  catchCopy: string;
  description: string;
  url: string;
  hashTag: string;
  startedAt: string;
  endedAt: string;
  limit: number | null;
  address: string | null;
  place: string | null;
  accepted: number;
  waiting: number;
}

export interface ConnpassEventSearchResult {
  resultsStart: number;
  resultsReturned: number;
  resultsAvailable: number;
  events: ConnpassEvent[];
}
