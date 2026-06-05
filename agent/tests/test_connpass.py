"""Tests for agent/tools/connpass.py — pure functions only.

Uses requests-mock for HTTP stubbing and moto for DynamoDB.
Never imports strands or bedrock_agentcore.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import boto3
import pytest
import requests
from moto import mock_aws

from tools.connpass import _format_event, get_upcoming_events, search_connpass_events

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_API_BASE = "https://connpass.test/api/v2"
_API_KEY = "test-api-key"


def _make_raw_event(**overrides: Any) -> dict:
    """Return a minimal raw connpass v2 event dict."""
    base: dict[str, Any] = {
        "id": 123,
        "title": "Test Event",
        "event_url": "https://example.connpass.com/event/123/",
        "started_at": "2026-07-01T18:00:00+09:00",
        "ended_at": "2026-07-01T20:00:00+09:00",
        "place": "東京都渋谷区",
        "address": "渋谷区道玄坂1-1",
        "open_status": "open",
        "accepted": 42,
        "limit": 100,
        # Extra fields that should be ignored / not passed through
        "owner_display_name": "Organizer",
        "description": "Some HTML",
    }
    base.update(overrides)
    return base


def _api_response(events: list[dict]) -> dict:
    return {"events": events, "results_returned": len(events), "results_available": len(events)}


# ---------------------------------------------------------------------------
# DynamoDB fixtures via moto
# ---------------------------------------------------------------------------


@pytest.fixture()
def aws_credentials(monkeypatch):
    """Fake AWS credentials so moto doesn't contact real AWS."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")


@pytest.fixture()
def dynamo_tables(aws_credentials):
    """Create KeywordsTable and NotifiedEventsTable via moto and return them."""
    with mock_aws():
        dynamo = boto3.resource("dynamodb", region_name="ap-northeast-1")

        keywords_table = dynamo.create_table(
            TableName="KeywordsTable",
            KeySchema=[
                {"AttributeName": "scope_id", "KeyType": "HASH"},
                {"AttributeName": "keyword", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "scope_id", "AttributeType": "S"},
                {"AttributeName": "keyword", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )

        notified_table = dynamo.create_table(
            TableName="NotifiedEventsTable",
            KeySchema=[{"AttributeName": "event_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "event_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )

        yield keywords_table, notified_table


# ---------------------------------------------------------------------------
# _format_event tests
# ---------------------------------------------------------------------------


class TestFormatEvent:
    def test_maps_id_to_event_id(self):
        raw = _make_raw_event(id=99)
        result = _format_event(raw)
        assert result["event_id"] == 99

    def test_maps_event_url_to_url(self):
        raw = _make_raw_event(event_url="https://connpass.com/event/99/")
        result = _format_event(raw)
        assert result["url"] == "https://connpass.com/event/99/"

    def test_thumbnail_url_always_none(self):
        raw = _make_raw_event()
        result = _format_event(raw)
        assert result["thumbnail_url"] is None

    def test_all_contract_fields_present(self):
        raw = _make_raw_event()
        result = _format_event(raw)
        expected_keys = {
            "event_id",
            "title",
            "url",
            "started_at",
            "ended_at",
            "place",
            "address",
            "open_status",
            "accepted",
            "limit",
            "thumbnail_url",
        }
        assert set(result.keys()) == expected_keys

    def test_none_values_for_missing_fields(self):
        result = _format_event({})
        assert result["event_id"] is None
        assert result["url"] is None
        assert result["started_at"] is None

    def test_extra_raw_fields_not_included(self):
        raw = _make_raw_event(owner_display_name="Organizer", description="<p>HTML</p>")
        result = _format_event(raw)
        assert "owner_display_name" not in result
        assert "description" not in result

    def test_accepted_and_limit_numeric(self):
        raw = _make_raw_event(accepted=15, limit=50)
        result = _format_event(raw)
        assert result["accepted"] == 15
        assert result["limit"] == 50


# ---------------------------------------------------------------------------
# search_connpass_events tests
# ---------------------------------------------------------------------------


class TestSearchConnpassEvents:
    def test_returns_formatted_events(self, requests_mock):
        events_data = [_make_raw_event(id=1, title="AWS勉強会"), _make_raw_event(id=2, title="Python入門")]
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response(events_data))

        result = search_connpass_events("AWS", count=10, api_key=_API_KEY, api_base=_API_BASE)

        assert len(result) == 2
        assert result[0]["event_id"] == 1
        assert result[0]["title"] == "AWS勉強会"
        assert result[0]["url"] == events_data[0]["event_url"]
        assert result[0]["thumbnail_url"] is None

    def test_sends_x_api_key_header(self, requests_mock):
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([]))
        search_connpass_events("test", api_key=_API_KEY, api_base=_API_BASE)
        assert requests_mock.last_request.headers["X-API-Key"] == _API_KEY

    def test_sends_correct_query_params(self, requests_mock):
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([]))
        search_connpass_events("Python", count=5, api_key=_API_KEY, api_base=_API_BASE)
        # requests_mock.qs lowercases values via urllib; check the raw URL for case-sensitive keyword.
        url = requests_mock.last_request.url
        assert "keyword=Python" in url
        assert "count=5" in url
        assert "order=2" in url  # order=2: 開催日時順

    def test_empty_events_returns_empty_list(self, requests_mock):
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([]))
        result = search_connpass_events("no-match", api_key=_API_KEY, api_base=_API_BASE)
        assert result == []

    def test_raises_on_http_error(self, requests_mock):
        requests_mock.get(f"{_API_BASE}/events/", status_code=403)
        with pytest.raises(requests.exceptions.HTTPError):
            search_connpass_events("test", api_key=_API_KEY, api_base=_API_BASE)

    def test_uses_injected_session(self, requests_mock):
        """Verify the session parameter is actually used for the request."""
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([_make_raw_event(id=777)]))
        session = requests.Session()
        result = search_connpass_events("test", api_key=_API_KEY, api_base=_API_BASE, session=session)
        assert result[0]["event_id"] == 777

    def test_missing_events_key_in_response(self, requests_mock):
        """If the API returns a response without an 'events' key, return empty list."""
        requests_mock.get(f"{_API_BASE}/events/", json={})
        result = search_connpass_events("test", api_key=_API_KEY, api_base=_API_BASE)
        assert result == []

    def test_field_mapping_completeness(self, requests_mock):
        raw = _make_raw_event(
            id=10,
            title="DDD",
            event_url="https://connpass.com/event/10/",
            started_at="2026-08-01T10:00:00+09:00",
            ended_at="2026-08-01T12:00:00+09:00",
            place="大阪",
            address="大阪市北区",
            open_status="closed",
            accepted=5,
            limit=10,
        )
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([raw]))
        result = search_connpass_events("DDD", api_key=_API_KEY, api_base=_API_BASE)
        ev = result[0]
        assert ev["event_id"] == 10
        assert ev["title"] == "DDD"
        assert ev["url"] == "https://connpass.com/event/10/"
        assert ev["started_at"] == "2026-08-01T10:00:00+09:00"
        assert ev["ended_at"] == "2026-08-01T12:00:00+09:00"
        assert ev["place"] == "大阪"
        assert ev["address"] == "大阪市北区"
        assert ev["open_status"] == "closed"
        assert ev["accepted"] == 5
        assert ev["limit"] == 10
        assert ev["thumbnail_url"] is None


# ---------------------------------------------------------------------------
# get_upcoming_events tests
# ---------------------------------------------------------------------------


class TestGetUpcomingEvents:
    def _seed_keyword(self, table, scope_id: str, keyword: str, enabled: bool = True):
        table.put_item(
            Item={
                "scope_id": scope_id,
                "keyword": keyword,
                "created_at": "2026-01-01T00:00:00+00:00",
                "enabled": enabled,
            }
        )

    def test_returns_empty_when_no_keywords(self, dynamo_tables, requests_mock):
        kw_table, notified_table = dynamo_tables
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([]))
        result = get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
        )
        assert result == []

    def test_skips_disabled_keywords(self, dynamo_tables, requests_mock):
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "AWS", enabled=False)
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([_make_raw_event(id=1)]))

        result = get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
        )
        # No enabled keywords, so no HTTP calls and empty result.
        assert result == []
        assert requests_mock.call_count == 0

    def test_returns_new_events(self, dynamo_tables, requests_mock):
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "AWS")
        requests_mock.get(
            f"{_API_BASE}/events/",
            json=_api_response([_make_raw_event(id=100, title="AWS Summit")]),
        )
        fixed_now = datetime(2026, 6, 5, 9, 0, 0, tzinfo=UTC)

        result = get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
            now=fixed_now,
        )
        assert len(result) == 1
        assert result[0]["event_id"] == 100

    def test_dedup_already_notified_skipped(self, dynamo_tables, requests_mock):
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "AWS")
        # Pre-seed notified table
        notified_table.put_item(
            Item={"event_id": "100", "notified_at": "2026-01-01T00:00:00+00:00", "ttl": 9999999999}
        )
        requests_mock.get(
            f"{_API_BASE}/events/",
            json=_api_response([_make_raw_event(id=100, title="AWS Summit")]),
        )

        result = get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
        )
        assert result == []

    def test_new_events_recorded_in_notified_table(self, dynamo_tables, requests_mock):
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "Python")
        requests_mock.get(
            f"{_API_BASE}/events/",
            json=_api_response([_make_raw_event(id=200, title="PyCon")]),
        )
        fixed_now = datetime(2026, 6, 5, 9, 0, 0, tzinfo=UTC)

        get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
            ttl_days=30,
            now=fixed_now,
        )

        item = notified_table.get_item(Key={"event_id": "200"})["Item"]
        assert item["event_id"] == "200"
        assert item["notified_at"] == fixed_now.isoformat()
        expected_ttl = int(fixed_now.timestamp()) + 30 * 86400
        assert item["ttl"] == expected_ttl

    def test_sleep_called_between_not_after_last(self, dynamo_tables, requests_mock, monkeypatch):
        """sleep should be called N-1 times for N keywords (between, not after last)."""
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "AWS")
        self._seed_keyword(kw_table, "C001", "Python")
        self._seed_keyword(kw_table, "C001", "機械学習")
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([]))

        sleep_calls: list[float] = []
        monkeypatch.setattr("tools.connpass.time.sleep", lambda s: sleep_calls.append(s))

        get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
            interval_sec=0.5,
        )
        # 3 keywords → 2 sleeps (between keyword 1→2 and 2→3, not after keyword 3)
        assert len(sleep_calls) == 2
        assert all(s == 0.5 for s in sleep_calls)

    def test_sleep_not_called_for_single_keyword(self, dynamo_tables, requests_mock, monkeypatch):
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "AWS")
        requests_mock.get(f"{_API_BASE}/events/", json=_api_response([]))

        sleep_calls: list[float] = []
        monkeypatch.setattr("tools.connpass.time.sleep", lambda s: sleep_calls.append(s))

        get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
            interval_sec=1.0,
        )
        assert sleep_calls == []

    def test_dedup_within_batch(self, dynamo_tables, requests_mock):
        """Same event_id appearing under two keywords is returned only once."""
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "AWS")
        self._seed_keyword(kw_table, "C001", "クラウド")
        # Both keywords return the same event
        requests_mock.get(
            f"{_API_BASE}/events/",
            json=_api_response([_make_raw_event(id=300, title="AWS Cloud")]),
        )

        result = get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
        )
        assert len(result) == 1
        assert result[0]["event_id"] == 300

    def test_mix_new_and_notified_events(self, dynamo_tables, requests_mock):
        kw_table, notified_table = dynamo_tables
        self._seed_keyword(kw_table, "C001", "AWS")
        # event 400 already notified, 401 is new
        notified_table.put_item(
            Item={"event_id": "400", "notified_at": "2026-01-01T00:00:00+00:00", "ttl": 9999999999}
        )
        requests_mock.get(
            f"{_API_BASE}/events/",
            json=_api_response([_make_raw_event(id=400, title="Old"), _make_raw_event(id=401, title="New")]),
        )

        result = get_upcoming_events(
            "C001",
            api_key=_API_KEY,
            keywords_table=kw_table,
            notified_table=notified_table,
            api_base=_API_BASE,
        )
        assert len(result) == 1
        assert result[0]["event_id"] == 401
