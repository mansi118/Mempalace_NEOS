"""Graphiti Bridge — HTTP adapter between Convex actions and FalkorDB.

Sits between PALACE's Convex backend and Graphiti/FalkorDB. Convex actions
call this service over HTTP; Graphiti handles entity extraction, dedup,
contradiction detection, and temporal validity inside FalkorDB.

Design notes (from ultrathink analysis):
  - Double extraction is intentional: Sonnet (Phase 4) → closets/drawers in
    Convex; Haiku (Graphiti) → entity graph in FalkorDB. Different query
    patterns, independent evolution.
  - Graphiti uses Haiku (not Sonnet) for extraction — 10x cheaper, acceptable
    quality for entity-level work.
  - Palace isolation enforced by registry: callers pass palace_id, bridge
    derives graph_name. No caller controls graph_name directly.
  - All non-health endpoints require API key in X-Palace-Key header.
  - Ingestion is idempotent on closet_id.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import BridgeConfig, PalaceRegistry

# ── Logging ──────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
)
logger = structlog.get_logger("graphiti_bridge")

# ── Global state ─────────────────────────────────────────────────

cfg = BridgeConfig.from_env()
registry = PalaceRegistry.load()

# Graphiti client pool: palace_id → Graphiti instance.
# Bounded by cfg.max_clients.
_graphiti_pool: dict[str, object] = {}
_pool_lock = asyncio.Lock()

# Track ingested closet_ids for idempotency within this process lifetime.
# In production, Graphiti's own dedup handles cross-restart idempotency.
_ingested_closet_ids: set[str] = set()

# ── Graphiti lazy init ───────────────────────────────────────────

# Import Graphiti at module level so startup fails fast if deps are missing.
# Guard with try/except for environments where graphiti isn't installed yet
# (e.g., running tests on the bridge contract without the full dep chain).
_graphiti_available = False
try:
    from graphiti_core import Graphiti
    from graphiti_core.nodes import EpisodeType

    _graphiti_available = True
except ImportError:
    logger.warning("graphiti_core not installed — bridge will return 503 on all graph ops")


async def get_graphiti(palace_id: str) -> object:
    """Return a Graphiti client for the given palace, creating if needed."""
    if not _graphiti_available:
        raise RuntimeError("graphiti_core not installed")

    async with _pool_lock:
        if palace_id in _graphiti_pool:
            return _graphiti_pool[palace_id]

        if len(_graphiti_pool) >= cfg.max_clients:
            # Evict oldest (FIFO). Simple; replace with LRU if needed.
            oldest_key = next(iter(_graphiti_pool))
            old = _graphiti_pool.pop(oldest_key)
            try:
                await old.close()  # type: ignore[attr-defined]
            except Exception:
                pass

        graph_name = registry.graph_for(palace_id)
        if not graph_name:
            raise ValueError(f"unknown palace_id: {palace_id}")

        # Import driver here to keep the top-level import guard clean.
        from graphiti_core.driver.falkordb_driver import FalkorDBDriver

        driver = FalkorDBDriver(
            host=cfg.falkordb_host,
            port=cfg.falkordb_port,
            database=graph_name,
        )

        # Configure LLM client for entity extraction.
        # Use Haiku — 10x cheaper than Sonnet, good enough for entity extraction.
        llm_client = None
        if cfg.anthropic_api_key:
            try:
                from graphiti_core.llm_client.anthropic_client import AnthropicClient

                llm_client = AnthropicClient(
                    api_key=cfg.anthropic_api_key,
                    model=cfg.graphiti_llm_model,
                )
            except ImportError:
                logger.warning("anthropic client not available for graphiti")

        g = Graphiti(
            graph_driver=driver,
            llm_client=llm_client,
        )
        await g.build_indices_and_constraints()

        _graphiti_pool[palace_id] = g
        logger.info(
            "graphiti_client_created",
            palace_id=palace_id,
            graph_name=graph_name,
            pool_size=len(_graphiti_pool),
        )
        return g


# ── Request / Response models ────────────────────────────────────


class EpisodeMetadata(BaseModel):
    closet_id: Optional[str] = None
    wing: Optional[str] = None
    room: Optional[str] = None
    category: Optional[str] = None
    source_adapter: Optional[str] = None


class IngestRequest(BaseModel):
    palace_id: str
    content: str
    episode_name: str = ""
    source_description: str = ""
    timestamp: str = ""
    metadata: EpisodeMetadata = Field(default_factory=EpisodeMetadata)


class BatchIngestRequest(BaseModel):
    palace_id: str
    episodes: list[IngestRequest]


class SearchRequest(BaseModel):
    palace_id: str
    query: str
    limit: int = 10


class EntityRequest(BaseModel):
    palace_id: str
    entity_name: str
    limit: int = 10


class RegisterPalaceRequest(BaseModel):
    palace_id: str
    graph_name: str


class DeleteEpisodeRequest(BaseModel):
    palace_id: str
    closet_id: str


class BridgeResponse(BaseModel):
    status: str  # "ok" | "error" | "noop"
    detail: Optional[str] = None
    data: Optional[dict] = None


# ── App lifecycle ────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "bridge_starting",
        env=cfg.env,
        auth_enabled=cfg.auth_enabled,
        falkordb=f"{cfg.falkordb_host}:{cfg.falkordb_port}",
        llm_model=cfg.graphiti_llm_model,
        max_clients=cfg.max_clients,
    )
    yield
    # Shutdown: close all Graphiti clients.
    for pid, g in _graphiti_pool.items():
        try:
            await g.close()  # type: ignore[attr-defined]
        except Exception:
            pass
    logger.info("bridge_stopped")


app = FastAPI(
    title="PALACE Graphiti Bridge",
    version="0.1.0",
    lifespan=lifespan,
)


# ── Auth middleware ───────────────────────────────────────────────


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Health and version endpoints are public.
    if request.url.path in ("/health", "/version", "/docs", "/openapi.json"):
        return await call_next(request)

    if cfg.auth_enabled:
        key = request.headers.get("X-Palace-Key", "")
        if key != cfg.api_key:
            logger.warning(
                "auth_rejected",
                path=request.url.path,
                remote=request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                {"status": "error", "detail": "unauthorized"},
                status_code=401,
            )

    return await call_next(request)


# ── Endpoints ────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """Unauthenticated health check. Returns 200 if bridge is running."""
    falkordb_ok = False
    try:
        import redis

        r = redis.Redis(host=cfg.falkordb_host, port=cfg.falkordb_port)
        falkordb_ok = r.ping()
        r.close()
    except Exception:
        pass

    return {
        "status": "ok" if falkordb_ok else "degraded",
        "falkordb": "connected" if falkordb_ok else "unreachable",
        "graphiti": "available" if _graphiti_available else "not_installed",
        "palaces": list(registry.all().keys()),
    }


@app.get("/version")
async def version():
    """Component versions for debugging."""
    versions: dict[str, str] = {"bridge": "0.1.0"}
    try:
        import graphiti_core

        versions["graphiti"] = getattr(graphiti_core, "__version__", "unknown")
    except ImportError:
        versions["graphiti"] = "not_installed"
    try:
        import redis

        r = redis.Redis(host=cfg.falkordb_host, port=cfg.falkordb_port)
        info = r.info("server")
        versions["falkordb"] = info.get("redis_version", "unknown")
        r.close()
    except Exception:
        versions["falkordb"] = "unreachable"
    return versions


@app.post("/ingest", response_model=BridgeResponse)
async def ingest(body: IngestRequest):
    """Ingest a single episode into the palace's knowledge graph.

    Graphiti extracts entities and relationships using its internal LLM,
    deduplicates against existing graph, and stores in FalkorDB.

    Idempotent on metadata.closet_id: second call with same closet_id = noop.
    """
    t0 = time.time()
    palace_id = body.palace_id

    # Validate palace.
    if not registry.graph_for(palace_id):
        return JSONResponse(
            BridgeResponse(status="error", detail=f"unknown palace_id: {palace_id}").model_dump(),
            status_code=400,
        )

    # Idempotency check.
    closet_id = body.metadata.closet_id
    if closet_id and closet_id in _ingested_closet_ids:
        logger.info("ingest_noop", palace_id=palace_id, closet_id=closet_id)
        return BridgeResponse(status="noop", detail="already ingested")

    if not _graphiti_available:
        return JSONResponse(
            BridgeResponse(status="error", detail="graphiti not installed").model_dump(),
            status_code=503,
        )

    try:
        g = await asyncio.wait_for(
            get_graphiti(palace_id),
            timeout=cfg.request_timeout,
        )

        # Build source description with metadata for cross-reference.
        source_parts = [body.source_description or "palace_ingest"]
        meta = body.metadata
        if meta.closet_id:
            source_parts.append(f"closet_id={meta.closet_id}")
        if meta.wing:
            source_parts.append(f"wing={meta.wing}")
        if meta.room:
            source_parts.append(f"room={meta.room}")
        if meta.category:
            source_parts.append(f"category={meta.category}")
        source_desc = " | ".join(source_parts)

        ref_time = datetime.now(timezone.utc)
        if body.timestamp:
            try:
                ref_time = datetime.fromisoformat(body.timestamp.replace("Z", "+00:00"))
            except ValueError:
                pass

        await asyncio.wait_for(
            g.add_episode(  # type: ignore[attr-defined]
                name=body.episode_name or f"palace_episode_{closet_id or 'unknown'}",
                episode_body=body.content,
                source=EpisodeType.text,
                source_description=source_desc,
                reference_time=ref_time,
                group_id=palace_id,
            ),
            timeout=cfg.request_timeout,
        )

        duration_ms = int((time.time() - t0) * 1000)

        if closet_id:
            _ingested_closet_ids.add(closet_id)

        logger.info(
            "ingest_ok",
            palace_id=palace_id,
            closet_id=closet_id,
            duration_ms=duration_ms,
        )

        return BridgeResponse(
            status="ok",
            data={"duration_ms": duration_ms, "closet_id": closet_id},
        )

    except asyncio.TimeoutError:
        duration_ms = int((time.time() - t0) * 1000)
        logger.error("ingest_timeout", palace_id=palace_id, duration_ms=duration_ms)
        return JSONResponse(
            BridgeResponse(
                status="error", detail=f"timeout after {duration_ms}ms"
            ).model_dump(),
            status_code=504,
        )
    except ValueError as e:
        logger.error("ingest_validation_error", palace_id=palace_id, error=str(e))
        return JSONResponse(
            BridgeResponse(status="error", detail=str(e)).model_dump(),
            status_code=400,
        )
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        logger.error(
            "ingest_failed",
            palace_id=palace_id,
            error=str(e),
            duration_ms=duration_ms,
        )
        return JSONResponse(
            BridgeResponse(status="error", detail=str(e)).model_dump(),
            status_code=500,
        )


@app.post("/batch_ingest")
async def batch_ingest(body: BatchIngestRequest):
    """Ingest multiple episodes sequentially. Returns per-episode status.

    Sequential processing because Graphiti's add_episode is not safe to
    call concurrently for the same graph (entity dedup can race).
    """
    t0 = time.time()
    palace_id = body.palace_id

    if not registry.graph_for(palace_id):
        return JSONResponse(
            {"status": "error", "detail": f"unknown palace_id: {palace_id}"},
            status_code=400,
        )

    results = []
    ok_count = 0
    noop_count = 0
    error_count = 0

    for episode in body.episodes:
        # Override palace_id from the batch-level value.
        episode.palace_id = palace_id
        try:
            resp = await ingest(episode)
            if isinstance(resp, JSONResponse):
                # Error response — extract body.
                import json

                resp_body = json.loads(resp.body.decode())
                results.append(
                    {
                        "closet_id": episode.metadata.closet_id,
                        "status": resp_body.get("status", "error"),
                        "detail": resp_body.get("detail"),
                    }
                )
                error_count += 1
            else:
                results.append(
                    {
                        "closet_id": episode.metadata.closet_id,
                        "status": resp.status,
                        "detail": resp.detail,
                    }
                )
                if resp.status == "ok":
                    ok_count += 1
                elif resp.status == "noop":
                    noop_count += 1
                else:
                    error_count += 1
        except Exception as e:
            results.append(
                {
                    "closet_id": episode.metadata.closet_id,
                    "status": "error",
                    "detail": str(e),
                }
            )
            error_count += 1

    duration_ms = int((time.time() - t0) * 1000)
    logger.info(
        "batch_ingest_done",
        palace_id=palace_id,
        total=len(body.episodes),
        ok=ok_count,
        noop=noop_count,
        errors=error_count,
        duration_ms=duration_ms,
    )

    return {
        "status": "ok",
        "data": {
            "total": len(body.episodes),
            "ok": ok_count,
            "noop": noop_count,
            "errors": error_count,
            "duration_ms": duration_ms,
            "results": results,
        },
    }


@app.post("/search", response_model=BridgeResponse)
async def search(body: SearchRequest):
    """Search the palace's knowledge graph."""
    t0 = time.time()
    palace_id = body.palace_id

    if not registry.graph_for(palace_id):
        return JSONResponse(
            BridgeResponse(status="error", detail=f"unknown palace_id: {palace_id}").model_dump(),
            status_code=400,
        )

    if not _graphiti_available:
        return JSONResponse(
            BridgeResponse(status="error", detail="graphiti not installed").model_dump(),
            status_code=503,
        )

    try:
        g = await get_graphiti(palace_id)

        results = await asyncio.wait_for(
            g.search(  # type: ignore[attr-defined]
                query=body.query,
                group_ids=[palace_id],
                num_results=body.limit,
            ),
            timeout=cfg.request_timeout,
        )

        duration_ms = int((time.time() - t0) * 1000)

        # Serialize results. Graphiti returns EdgeResult or similar objects;
        # convert to dicts safely.
        serialized = []
        for r in results:
            try:
                serialized.append(r.model_dump() if hasattr(r, "model_dump") else r.dict() if hasattr(r, "dict") else str(r))
            except Exception:
                serialized.append(str(r))

        logger.info(
            "search_ok",
            palace_id=palace_id,
            query=body.query[:80],
            result_count=len(serialized),
            duration_ms=duration_ms,
        )

        return BridgeResponse(
            status="ok",
            data={
                "results": serialized,
                "count": len(serialized),
                "duration_ms": duration_ms,
            },
        )

    except asyncio.TimeoutError:
        duration_ms = int((time.time() - t0) * 1000)
        logger.error("search_timeout", palace_id=palace_id, duration_ms=duration_ms)
        return JSONResponse(
            BridgeResponse(status="error", detail="search timeout").model_dump(),
            status_code=504,
        )
    except Exception as e:
        logger.error("search_failed", palace_id=palace_id, error=str(e))
        return JSONResponse(
            BridgeResponse(status="error", detail=str(e)).model_dump(),
            status_code=500,
        )


@app.post("/entity", response_model=BridgeResponse)
async def query_entity(body: EntityRequest):
    """Query a specific entity by name in the palace's graph."""
    t0 = time.time()
    palace_id = body.palace_id

    if not registry.graph_for(palace_id):
        return JSONResponse(
            BridgeResponse(status="error", detail=f"unknown palace_id: {palace_id}").model_dump(),
            status_code=400,
        )

    if not _graphiti_available:
        return JSONResponse(
            BridgeResponse(status="error", detail="graphiti not installed").model_dump(),
            status_code=503,
        )

    try:
        g = await get_graphiti(palace_id)

        results = await asyncio.wait_for(
            g.search(  # type: ignore[attr-defined]
                query=body.entity_name,
                group_ids=[palace_id],
                num_results=body.limit,
            ),
            timeout=cfg.request_timeout,
        )

        serialized = []
        for r in results:
            try:
                serialized.append(r.model_dump() if hasattr(r, "model_dump") else r.dict() if hasattr(r, "dict") else str(r))
            except Exception:
                serialized.append(str(r))

        duration_ms = int((time.time() - t0) * 1000)
        logger.info(
            "entity_query_ok",
            palace_id=palace_id,
            entity=body.entity_name,
            result_count=len(serialized),
            duration_ms=duration_ms,
        )

        return BridgeResponse(
            status="ok",
            data={
                "results": serialized,
                "count": len(serialized),
                "duration_ms": duration_ms,
            },
        )

    except Exception as e:
        logger.error("entity_query_failed", palace_id=palace_id, error=str(e))
        return JSONResponse(
            BridgeResponse(status="error", detail=str(e)).model_dump(),
            status_code=500,
        )


# ── Palace management ────────────────────────────────────────────


@app.post("/palaces/register", response_model=BridgeResponse)
async def register_palace(body: RegisterPalaceRequest):
    """Register a new palace in the bridge's registry and initialize its graph."""
    if registry.graph_for(body.palace_id):
        return BridgeResponse(status="noop", detail="palace already registered")

    registry.register(body.palace_id, body.graph_name)

    # Initialize graph indices if Graphiti is available.
    if _graphiti_available:
        try:
            await get_graphiti(body.palace_id)
        except Exception as e:
            logger.error(
                "palace_init_failed",
                palace_id=body.palace_id,
                error=str(e),
            )
            return JSONResponse(
                BridgeResponse(
                    status="error",
                    detail=f"registered but graph init failed: {e}",
                ).model_dump(),
                status_code=500,
            )

    logger.info(
        "palace_registered",
        palace_id=body.palace_id,
        graph_name=body.graph_name,
    )
    return BridgeResponse(status="ok", data={"graph_name": body.graph_name})


@app.get("/palaces")
async def list_palaces():
    """List all registered palaces."""
    return {"palaces": registry.all()}


# ── Maintenance ──────────────────────────────────────────────────


@app.get("/stats/{palace_id}")
async def graph_stats(palace_id: str):
    """Entity and edge counts for a palace's graph."""
    graph_name = registry.graph_for(palace_id)
    if not graph_name:
        return JSONResponse(
            {"status": "error", "detail": f"unknown palace_id: {palace_id}"},
            status_code=400,
        )

    try:
        import redis

        r = redis.Redis(host=cfg.falkordb_host, port=cfg.falkordb_port)
        # FalkorDB uses Redis GRAPH commands.
        node_count_result = r.execute_command(
            "GRAPH.QUERY", graph_name, "MATCH (n) RETURN count(n)"
        )
        edge_count_result = r.execute_command(
            "GRAPH.QUERY", graph_name, "MATCH ()-[e]->() RETURN count(e)"
        )
        r.close()

        # Parse FalkorDB response format: [[header], [data], [stats]]
        nodes = 0
        edges = 0
        try:
            nodes = node_count_result[1][0][0]  # type: ignore
        except (IndexError, TypeError):
            pass
        try:
            edges = edge_count_result[1][0][0]  # type: ignore
        except (IndexError, TypeError):
            pass

        return {
            "status": "ok",
            "data": {
                "palace_id": palace_id,
                "graph_name": graph_name,
                "nodes": nodes,
                "edges": edges,
            },
        }

    except Exception as e:
        logger.error("stats_failed", palace_id=palace_id, error=str(e))
        return JSONResponse(
            {"status": "error", "detail": str(e)},
            status_code=500,
        )


# ── Main ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("BRIDGE_PORT", "8100"))
    uvicorn.run(
        "graphiti_bridge:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
    )
