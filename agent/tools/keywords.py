"""Pure functions for managing per-scope search keywords in DynamoDB (KeywordsTable §5).

No strands / bedrock_agentcore imports — fully unit-testable in isolation.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime


def _normalize(keyword: str) -> str:
    """Strip leading/trailing whitespace and collapse internal runs of whitespace to a single space."""
    return re.sub(r"\s+", " ", keyword.strip())


def register_keyword(
    keyword: str,
    scope_id: str,
    *,
    table,
    max_keywords: int = 10,
    now: datetime | None = None,
) -> dict:
    """Register *keyword* for *scope_id* in *table* (upsert).

    Normalizes whitespace, enforces the per-scope ``max_keywords`` cap, and
    sets ``enabled=True`` with ``created_at`` on new items (upsert preserves
    ``created_at`` if the item already exists — we always write it so an
    already-disabled keyword gets re-enabled).

    Parameters
    ----------
    keyword:
        Raw keyword string; whitespace will be normalized.
    scope_id:
        Partition key — typically a Slack channel ID.
    table:
        boto3 DynamoDB ``Table`` resource (KeywordsTable schema per §5).
    max_keywords:
        Maximum number of keywords allowed per scope.  When the current count
        (excluding the keyword being upserted) equals or exceeds this limit,
        returns ``{"ok": False, "reason": "..."}`` without raising.
    now:
        Injected current UTC datetime for deterministic tests.

    Returns
    -------
    dict
        ``{"ok": True, "keyword": <normalized>}`` on success, or
        ``{"ok": False, "reason": <message>}`` when the cap would be exceeded.
    """
    if now is None:
        now = datetime.now(UTC)

    normalized = _normalize(keyword)

    # Check cap: count existing keywords for this scope, excluding the one we're upserting.
    existing_response = table.query(
        KeyConditionExpression="scope_id = :sid",
        ExpressionAttributeValues={":sid": scope_id},
    )
    existing_items = existing_response.get("Items", [])
    existing_keywords = {item["keyword"] for item in existing_items}

    # Only count against cap if this is a NEW keyword (not a re-register/update).
    is_new = normalized not in existing_keywords
    if is_new and len(existing_keywords) >= max_keywords:
        return {
            "ok": False,
            "reason": (
                f"Keyword cap ({max_keywords}) reached for scope '{scope_id}'. Delete an existing keyword first."
            ),
        }

    table.put_item(
        Item={
            "scope_id": scope_id,
            "keyword": normalized,
            "created_at": now.isoformat(),
            "enabled": True,
        }
    )
    return {"ok": True, "keyword": normalized}


def list_keywords(scope_id: str, *, table) -> list[dict]:
    """Return all keyword items for *scope_id*.

    Parameters
    ----------
    scope_id:
        Partition key to query.
    table:
        boto3 DynamoDB ``Table`` resource (KeywordsTable).

    Returns
    -------
    list[dict]
        Raw DynamoDB items (each has ``scope_id``, ``keyword``, ``created_at``,
        ``enabled``).
    """
    response = table.query(
        KeyConditionExpression="scope_id = :sid",
        ExpressionAttributeValues={":sid": scope_id},
    )
    return response.get("Items", [])


def delete_keyword(keyword: str, scope_id: str, *, table) -> dict:
    """Delete *keyword* from *scope_id* in *table*.

    Parameters
    ----------
    keyword:
        Raw keyword string; whitespace will be normalized before deletion.
    scope_id:
        Partition key.
    table:
        boto3 DynamoDB ``Table`` resource (KeywordsTable).

    Returns
    -------
    dict
        ``{"ok": True, "keyword": <normalized>, "scope_id": scope_id}``
    """
    normalized = _normalize(keyword)
    table.delete_item(Key={"scope_id": scope_id, "keyword": normalized})
    return {"ok": True, "keyword": normalized, "scope_id": scope_id}
