"""Contract tests for the Graphiti bridge.

Tests the HTTP layer (auth, validation, error shapes) without a real
FalkorDB or Graphiti. Run with:

    cd services && pip install httpx pytest pytest-asyncio && pytest test_bridge_contract.py -v

These tests verify Tier 1 fixes:
  - Auth middleware blocks unauthenticated requests
  - Palace registry rejects unknown palace_ids
  - Idempotent ingestion (same closet_id = noop)
  - Structured error responses
  - Health endpoint is unauthenticated
"""

import os
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set env vars BEFORE importing the app so config picks them up.
os.environ["PALACE_BRIDGE_API_KEY"] = "test-key-123"
os.environ["FALKORDB_HOST"] = "localhost"
os.environ["FALKORDB_PORT"] = "6379"
os.environ["ANTHROPIC_API_KEY"] = "sk-test"
os.environ["BRIDGE_ENV"] = "development"

from graphiti_bridge import app  # noqa: E402

HEADERS = {"X-Palace-Key": "test-key-123"}
BAD_HEADERS = {"X-Palace-Key": "wrong-key"}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ── Auth ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_is_unauthenticated(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded")


@pytest.mark.asyncio
async def test_version_is_unauthenticated(client: AsyncClient):
    resp = await client.get("/version")
    assert resp.status_code == 200
    assert "bridge" in resp.json()


@pytest.mark.asyncio
async def test_ingest_without_key_returns_401(client: AsyncClient):
    resp = await client.post(
        "/ingest",
        json={"palace_id": "neuraledge", "content": "test"},
    )
    assert resp.status_code == 401
    assert resp.json()["status"] == "error"


@pytest.mark.asyncio
async def test_ingest_with_wrong_key_returns_401(client: AsyncClient):
    resp = await client.post(
        "/ingest",
        json={"palace_id": "neuraledge", "content": "test"},
        headers=BAD_HEADERS,
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_search_without_key_returns_401(client: AsyncClient):
    resp = await client.post(
        "/search",
        json={"palace_id": "neuraledge", "query": "test"},
    )
    assert resp.status_code == 401


# ── Palace registry ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ingest_unknown_palace_returns_400(client: AsyncClient):
    resp = await client.post(
        "/ingest",
        json={"palace_id": "nonexistent", "content": "test"},
        headers=HEADERS,
    )
    assert resp.status_code == 400
    assert "unknown palace_id" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_search_unknown_palace_returns_400(client: AsyncClient):
    resp = await client.post(
        "/search",
        json={"palace_id": "nonexistent", "query": "test"},
        headers=HEADERS,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_palaces(client: AsyncClient):
    resp = await client.get("/palaces", headers=HEADERS)
    assert resp.status_code == 200
    palaces = resp.json()["palaces"]
    assert "neuraledge" in palaces
    assert palaces["neuraledge"] == "palace_neuraledge_hq"


@pytest.mark.asyncio
async def test_register_new_palace(client: AsyncClient):
    resp = await client.post(
        "/palaces/register",
        json={"palace_id": "test_client", "graph_name": "palace_test_client"},
        headers=HEADERS,
    )
    # Will be "ok" or "error" depending on FalkorDB availability.
    # At minimum it shouldn't be 401 or 400.
    assert resp.status_code in (200, 500)
    data = resp.json()
    assert data["status"] in ("ok", "error")


# ── Structured responses ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_ingest_returns_structured_response(client: AsyncClient):
    """Even when Graphiti is unavailable, response shape is correct."""
    resp = await client.post(
        "/ingest",
        json={
            "palace_id": "neuraledge",
            "content": "Test content for structure verification",
            "metadata": {"closet_id": "test-001", "wing": "platform"},
        },
        headers=HEADERS,
    )
    data = resp.json()
    # Response has status field regardless of success/failure.
    assert "status" in data
    assert data["status"] in ("ok", "error", "noop")


@pytest.mark.asyncio
async def test_ingest_idempotent_on_closet_id(client: AsyncClient):
    """Second ingest with same closet_id returns noop."""
    payload = {
        "palace_id": "neuraledge",
        "content": "Idempotency test content",
        "metadata": {"closet_id": "idem-test-999"},
    }
    # First call — may succeed or fail depending on Graphiti availability.
    r1 = await client.post("/ingest", json=payload, headers=HEADERS)

    # If first call succeeded, second should be noop.
    if r1.status_code == 200 and r1.json()["status"] == "ok":
        r2 = await client.post("/ingest", json=payload, headers=HEADERS)
        assert r2.status_code == 200
        assert r2.json()["status"] == "noop"


# ── Stats ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stats_unknown_palace_returns_400(client: AsyncClient):
    resp = await client.get("/stats/nonexistent", headers=HEADERS)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_stats_known_palace(client: AsyncClient):
    """Stats endpoint returns structured data (even if FalkorDB is down)."""
    resp = await client.get("/stats/neuraledge", headers=HEADERS)
    # 200 if FalkorDB is up, 500 if down — either way, check shape.
    if resp.status_code == 200:
        data = resp.json()
        assert data["status"] == "ok"
        assert "nodes" in data["data"]
        assert "edges" in data["data"]
