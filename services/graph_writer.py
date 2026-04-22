"""
Graph writer — direct FalkorDB Cypher writes for entity ingestion.

Replaces Graphiti's add_episode with explicit Cypher MERGE queries.
No LLM dependency on this side — entities are pre-extracted by Convex.

Security (P0.2): all user-controlled values (entity names, closet IDs,
wing/room labels, query strings) are bound via FalkorDB's CYPHER param
prefix — never interpolated into the query body as raw strings. This
closes the injection surface that existed when entity names from LLM
output went through a simple backslash/quote escape.

Relationship types (rel_type in ingest_graph) are the one exception:
Cypher does not support binding edge types, so we enforce a strict
alphanumeric whitelist before inlining them.
"""

import json
import os
import re
import redis
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

FALKORDB_HOST = os.environ.get("FALKORDB_HOST", "localhost")
FALKORDB_PORT = int(os.environ.get("FALKORDB_PORT", "6379"))

# Relationship types in Cypher must be identifier-safe: letters, digits, _ only.
REL_TYPE_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


def get_redis() -> redis.Redis:
    return redis.Redis(host=FALKORDB_HOST, port=FALKORDB_PORT, decode_responses=True)


def _cypher_literal(value: Any) -> str:
    """Serialize a Python value to a Cypher literal safe for the CYPHER prefix.

    JSON is a proper subset of Cypher's literal grammar for scalars + arrays,
    so json.dumps handles escaping correctly for strings, numbers, booleans,
    null, and lists.
    """
    return json.dumps(value, ensure_ascii=False)


def _bind(params: dict[str, Any]) -> str:
    """Build a `CYPHER k1=v1 k2=v2 ... ` prefix from a params dict."""
    if not params:
        return ""
    parts = [f"{k}={_cypher_literal(v)}" for k, v in params.items()]
    return "CYPHER " + " ".join(parts) + " "


def _safe_rel_type(rel: str) -> str:
    """Normalise a relation label to a Cypher-safe identifier."""
    upper = rel.upper().replace(" ", "_").replace("-", "_")
    cleaned = "".join(c for c in upper if c.isalnum() or c == "_") or "RELATED_TO"
    # Strip leading digits — Cypher identifiers must start with a letter.
    while cleaned and not cleaned[0].isalpha():
        cleaned = cleaned[1:]
    if not cleaned or not REL_TYPE_RE.match(cleaned):
        return "RELATED_TO"
    return cleaned


class Entity(BaseModel):
    name: str
    type: str = "concept"
    aliases: list[str] = []


class Relation(BaseModel):
    from_entity: str
    to_entity: str
    relation: str


class GraphIngestRequest(BaseModel):
    palace_id: str
    closet_id: str
    graph_name: str = ""  # optional — derived from registry when empty
    wing: str = ""
    room: str = ""
    title: str = ""
    entities: list[Entity] = []
    relations: list[Relation] = []


class GraphSearchRequest(BaseModel):
    palace_id: str
    query: str
    graph_name: str = ""
    limit: int = 10


class GraphTraverseRequest(BaseModel):
    palace_id: str
    entity_name: str
    graph_name: str = ""
    max_depth: int = 2


def _resolve_graph(palace_id: str, graph_name: str) -> str | None:
    if graph_name:
        return graph_name
    from config import PalaceRegistry
    return PalaceRegistry.load().graph_for(palace_id)


def _run(r: redis.Redis, graph: str, params: dict[str, Any], query: str):
    """Execute a Cypher query with parameterized values.

    Params are bound via the `CYPHER k=v ...` prefix — FalkorDB parses them
    as its own literals, so string values cannot break out and become query
    structure.
    """
    full = _bind(params) + query
    return r.execute_command("GRAPH.QUERY", graph, full)


@router.post("/graph/ingest")
async def ingest_graph(body: GraphIngestRequest) -> dict[str, Any]:
    """Write a closet + its entities + relations to FalkorDB via Cypher MERGE."""
    graph = _resolve_graph(body.palace_id, body.graph_name)
    if not graph:
        return {"status": "error", "detail": f"unknown palace_id: {body.palace_id}"}
    r = get_redis()

    entities_created = 0
    relations_created = 0

    try:
        # 1. MERGE the closet node.
        _run(r, graph,
             {"cid": body.closet_id, "wing": body.wing, "room": body.room, "title": body.title[:200]},
             "MERGE (c:Closet {id: $cid}) "
             "ON CREATE SET c.wing = $wing, c.room = $room, c.title = $title "
             "RETURN c")

        # 2. MERGE each entity + link to closet.
        for entity in body.entities:
            if not entity.name.strip():
                continue

            _run(r, graph,
                 {"name": entity.name, "type": entity.type, "cid": body.closet_id},
                 "MERGE (e:Entity {name: $name}) "
                 "ON CREATE SET e.type = $type, e.occurrences = 1 "
                 "ON MATCH SET e.occurrences = e.occurrences + 1 "
                 "WITH e MATCH (c:Closet {id: $cid}) "
                 "MERGE (c)-[:MENTIONS]->(e)")
            entities_created += 1

            # Aliases as separate property array.
            if entity.aliases:
                _run(r, graph,
                     {"name": entity.name, "aliases": list(entity.aliases[:5])},
                     "MATCH (e:Entity {name: $name}) "
                     "SET e.aliases = $aliases "
                     "RETURN e")

        # 3. Co-occurrence edges (entities mentioned in same closet).
        entity_names = [e.name for e in body.entities if e.name.strip()]
        for i, a in enumerate(entity_names):
            for b in entity_names[i + 1:]:
                _run(r, graph,
                     {"a": a, "b": b},
                     "MATCH (a:Entity {name: $a}), (b:Entity {name: $b}) "
                     "MERGE (a)-[r:CO_OCCURS]-(b) "
                     "ON CREATE SET r.count = 1 "
                     "ON MATCH SET r.count = r.count + 1")

        # 4. Typed relations.
        for rel in body.relations:
            if not rel.from_entity.strip() or not rel.to_entity.strip():
                continue
            rel_type = _safe_rel_type(rel.relation)  # identifier whitelist

            _run(r, graph,
                 {"a": rel.from_entity, "b": rel.to_entity, "cid": body.closet_id},
                 f"MATCH (a:Entity {{name: $a}}), (b:Entity {{name: $b}}) "
                 f"MERGE (a)-[r:{rel_type}]->(b) "
                 f"ON CREATE SET r.source_closet = $cid, r.count = 1 "
                 f"ON MATCH SET r.count = r.count + 1")
            relations_created += 1

        return {
            "status": "ok",
            "data": {
                "closet_id": body.closet_id,
                "entities_ingested": entities_created,
                "relations_ingested": relations_created,
            },
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)[:300]}
    finally:
        r.close()


@router.post("/graph/search")
async def search_graph(body: GraphSearchRequest) -> dict[str, Any]:
    """Search entities by name substring, return their closets + neighbors."""
    graph = _resolve_graph(body.palace_id, body.graph_name)
    if not graph:
        return {"status": "error", "detail": f"unknown palace_id: {body.palace_id}"}
    r = get_redis()

    try:
        limit = max(1, min(int(body.limit), 100))  # integer range guard
        result = _run(r, graph,
                      {"q": body.query.lower()},
                      "MATCH (e:Entity) "
                      "WHERE toLower(e.name) CONTAINS $q "
                      "OPTIONAL MATCH (c:Closet)-[:MENTIONS]->(e) "
                      "RETURN e.name, e.type, e.occurrences, collect(c.id)[..5] AS closets "
                      "ORDER BY e.occurrences DESC "
                      f"LIMIT {limit}")
        parsed = parse_falkordb_result(result)
        return {"status": "ok", "data": {"results": parsed}}
    except Exception as e:
        return {"status": "error", "detail": str(e)[:300]}
    finally:
        r.close()


@router.post("/graph/traverse")
async def traverse_graph(body: GraphTraverseRequest) -> dict[str, Any]:
    """Return subgraph around an entity up to max_depth hops."""
    graph = _resolve_graph(body.palace_id, body.graph_name)
    if not graph:
        return {"status": "error", "detail": f"unknown palace_id: {body.palace_id}"}
    r = get_redis()
    depth = max(1, min(int(body.max_depth), 3))

    try:
        result = _run(r, graph,
                      {"name": body.entity_name},
                      f"MATCH path = (start:Entity {{name: $name}})-[*1..{depth}]-(connected) "
                      "RETURN DISTINCT connected.name, connected.type, connected.occurrences "
                      "LIMIT 50")
        parsed = parse_falkordb_result(result)
        return {"status": "ok", "data": {"start": body.entity_name, "connected": parsed}}
    except Exception as e:
        return {"status": "error", "detail": str(e)[:300]}
    finally:
        r.close()


@router.get("/graph/stats/{palace_id}")
async def graph_stats(palace_id: str) -> dict[str, Any]:
    """Entity + edge counts per palace graph."""
    from config import PalaceRegistry
    reg = PalaceRegistry.load()
    graph = reg.graph_for(palace_id)
    if not graph:
        return {"status": "error", "detail": f"unknown palace_id: {palace_id}"}

    r = get_redis()
    try:
        entity_result = r.execute_command("GRAPH.QUERY", graph, "MATCH (e:Entity) RETURN count(e)")
        closet_result = r.execute_command("GRAPH.QUERY", graph, "MATCH (c:Closet) RETURN count(c)")
        rel_result = r.execute_command("GRAPH.QUERY", graph, "MATCH ()-[r]->() RETURN count(r)")

        return {
            "status": "ok",
            "data": {
                "palace_id": palace_id,
                "graph": graph,
                "entities": parse_count(entity_result),
                "closets": parse_count(closet_result),
                "relationships": parse_count(rel_result),
            },
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)[:300]}
    finally:
        r.close()


def parse_falkordb_result(result: list) -> list[dict]:
    """FalkorDB returns [header, rows, stats]. Parse rows into dicts."""
    try:
        if len(result) < 2 or not result[0] or not result[1]:
            return []
        cols = []
        for col_info in result[0]:
            if isinstance(col_info, (list, tuple)) and len(col_info) >= 2:
                cols.append(col_info[1].decode() if isinstance(col_info[1], bytes) else str(col_info[1]))
            else:
                cols.append(str(col_info))

        parsed = []
        for row in result[1]:
            entry = {}
            for i, val in enumerate(row):
                if i < len(cols):
                    if isinstance(val, bytes):
                        val = val.decode()
                    entry[cols[i]] = val
            parsed.append(entry)
        return parsed
    except Exception:
        return []


def parse_count(result: list) -> int:
    try:
        return int(result[1][0][0])
    except (IndexError, TypeError, ValueError):
        return 0
