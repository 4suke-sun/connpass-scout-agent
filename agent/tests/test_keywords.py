"""Tests for agent/tools/keywords.py — pure functions only.

Uses moto mock_aws to create real DynamoDB tables and passes the boto3
Table resource directly to the functions under test.
Never imports strands or bedrock_agentcore.
"""

from __future__ import annotations

from datetime import UTC, datetime

import boto3
import pytest
from moto import mock_aws

from tools.keywords import delete_keyword, list_keywords, register_keyword

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def aws_credentials(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")


@pytest.fixture()
def keywords_table(aws_credentials):
    """Provide a fresh moto-backed KeywordsTable for each test."""
    with mock_aws():
        dynamo = boto3.resource("dynamodb", region_name="ap-northeast-1")
        table = dynamo.create_table(
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
        yield table


# ---------------------------------------------------------------------------
# register_keyword tests
# ---------------------------------------------------------------------------


class TestRegisterKeyword:
    def test_registers_new_keyword(self, keywords_table):
        result = register_keyword("AWS", "C001", table=keywords_table)
        assert result == {"ok": True, "keyword": "AWS"}

    def test_item_stored_in_dynamodb(self, keywords_table):
        fixed_now = datetime(2026, 6, 5, 9, 0, 0, tzinfo=UTC)
        register_keyword("Python", "C001", table=keywords_table, now=fixed_now)

        item = keywords_table.get_item(Key={"scope_id": "C001", "keyword": "Python"})["Item"]
        assert item["scope_id"] == "C001"
        assert item["keyword"] == "Python"
        assert item["enabled"] is True
        assert item["created_at"] == fixed_now.isoformat()

    def test_whitespace_normalization_strips(self, keywords_table):
        result = register_keyword("  AWS  ", "C001", table=keywords_table)
        assert result == {"ok": True, "keyword": "AWS"}

    def test_whitespace_normalization_collapses_internal(self, keywords_table):
        result = register_keyword("機械  学習", "C001", table=keywords_table)
        assert result == {"ok": True, "keyword": "機械 学習"}
        # The stored keyword should also be normalized
        items = list_keywords("C001", table=keywords_table)
        assert any(i["keyword"] == "機械 学習" for i in items)

    def test_whitespace_normalization_tabs_and_newlines(self, keywords_table):
        result = register_keyword("AWS\t勉強会\n", "C001", table=keywords_table)
        assert result["ok"] is True
        assert result["keyword"] == "AWS 勉強会"

    def test_upsert_existing_keyword_succeeds(self, keywords_table):
        register_keyword("AWS", "C001", table=keywords_table)
        # Register again — should succeed (upsert), not count against cap
        result = register_keyword("AWS", "C001", table=keywords_table)
        assert result["ok"] is True
        # Still only one item
        items = list_keywords("C001", table=keywords_table)
        assert len(items) == 1

    def test_max_keywords_cap_enforced(self, keywords_table):
        for i in range(3):
            r = register_keyword(f"keyword-{i}", "C001", table=keywords_table, max_keywords=3)
            assert r["ok"] is True

        result = register_keyword("overflow", "C001", table=keywords_table, max_keywords=3)
        assert result["ok"] is False
        assert "reason" in result
        assert "3" in result["reason"]

    def test_max_keywords_cap_returns_dict_not_raises(self, keywords_table):
        for i in range(2):
            register_keyword(f"kw{i}", "C001", table=keywords_table, max_keywords=2)
        # Should return dict, not raise
        result = register_keyword("overflow", "C001", table=keywords_table, max_keywords=2)
        assert isinstance(result, dict)
        assert result["ok"] is False

    def test_cap_is_per_scope(self, keywords_table):
        """Different scope_ids have independent caps."""
        for i in range(3):
            register_keyword(f"keyword-{i}", "C001", table=keywords_table, max_keywords=3)

        # C002 should still be able to register
        result = register_keyword("keyword-0", "C002", table=keywords_table, max_keywords=3)
        assert result["ok"] is True

    def test_upsert_does_not_consume_cap_slot(self, keywords_table):
        """Re-registering an existing keyword should not consume a new slot."""
        for i in range(3):
            register_keyword(f"keyword-{i}", "C001", table=keywords_table, max_keywords=3)

        # Re-register existing keyword — must succeed even though cap is hit
        result = register_keyword("keyword-0", "C001", table=keywords_table, max_keywords=3)
        assert result["ok"] is True

    def test_scope_isolation(self, keywords_table):
        register_keyword("AWS", "C001", table=keywords_table)
        register_keyword("Python", "C002", table=keywords_table)

        c001_items = list_keywords("C001", table=keywords_table)
        c002_items = list_keywords("C002", table=keywords_table)
        assert len(c001_items) == 1
        assert c001_items[0]["keyword"] == "AWS"
        assert len(c002_items) == 1
        assert c002_items[0]["keyword"] == "Python"

    def test_default_now_is_used_when_not_provided(self, keywords_table):
        result = register_keyword("Test", "C001", table=keywords_table)
        assert result["ok"] is True
        item = keywords_table.get_item(Key={"scope_id": "C001", "keyword": "Test"})["Item"]
        # Should have a created_at that is a valid ISO string
        assert "created_at" in item
        assert "T" in item["created_at"]


# ---------------------------------------------------------------------------
# list_keywords tests
# ---------------------------------------------------------------------------


class TestListKeywords:
    def test_empty_scope_returns_empty_list(self, keywords_table):
        result = list_keywords("C999", table=keywords_table)
        assert result == []

    def test_returns_all_registered_keywords(self, keywords_table):
        register_keyword("AWS", "C001", table=keywords_table)
        register_keyword("Python", "C001", table=keywords_table)

        result = list_keywords("C001", table=keywords_table)
        assert len(result) == 2
        keywords = {item["keyword"] for item in result}
        assert keywords == {"AWS", "Python"}

    def test_items_have_required_fields(self, keywords_table):
        fixed_now = datetime(2026, 6, 5, 9, 0, 0, tzinfo=UTC)
        register_keyword("AWS", "C001", table=keywords_table, now=fixed_now)

        items = list_keywords("C001", table=keywords_table)
        item = items[0]
        assert "scope_id" in item
        assert "keyword" in item
        assert "created_at" in item
        assert "enabled" in item

    def test_scope_isolation(self, keywords_table):
        register_keyword("AWS", "C001", table=keywords_table)
        register_keyword("Python", "C002", table=keywords_table)

        c001 = list_keywords("C001", table=keywords_table)
        assert all(i["scope_id"] == "C001" for i in c001)


# ---------------------------------------------------------------------------
# delete_keyword tests
# ---------------------------------------------------------------------------


class TestDeleteKeyword:
    def test_delete_existing_keyword(self, keywords_table):
        register_keyword("AWS", "C001", table=keywords_table)
        result = delete_keyword("AWS", "C001", table=keywords_table)

        assert result == {"ok": True, "keyword": "AWS", "scope_id": "C001"}
        items = list_keywords("C001", table=keywords_table)
        assert items == []

    def test_delete_normalizes_whitespace(self, keywords_table):
        register_keyword("機械学習", "C001", table=keywords_table)
        result = delete_keyword("  機械学習  ", "C001", table=keywords_table)

        assert result["ok"] is True
        assert result["keyword"] == "機械学習"

    def test_delete_nonexistent_keyword_returns_ok(self, keywords_table):
        """DynamoDB delete_item is idempotent — OK even if item doesn't exist."""
        result = delete_keyword("nonexistent", "C001", table=keywords_table)
        assert result["ok"] is True

    def test_delete_correct_scope_only(self, keywords_table):
        register_keyword("AWS", "C001", table=keywords_table)
        register_keyword("AWS", "C002", table=keywords_table)

        delete_keyword("AWS", "C001", table=keywords_table)

        c001 = list_keywords("C001", table=keywords_table)
        c002 = list_keywords("C002", table=keywords_table)
        assert c001 == []
        assert len(c002) == 1

    def test_delete_one_of_multiple(self, keywords_table):
        register_keyword("AWS", "C001", table=keywords_table)
        register_keyword("Python", "C001", table=keywords_table)

        delete_keyword("AWS", "C001", table=keywords_table)

        items = list_keywords("C001", table=keywords_table)
        assert len(items) == 1
        assert items[0]["keyword"] == "Python"

    def test_delete_returns_normalized_keyword_in_result(self, keywords_table):
        register_keyword("AWS Lambda", "C001", table=keywords_table)
        result = delete_keyword("AWS  Lambda", "C001", table=keywords_table)
        assert result["keyword"] == "AWS Lambda"
