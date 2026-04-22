"""
Graph writer — direct FalkorDB Cypher writes for entity ingestion.

Replaces Graphiti's add_episode with explicit Cypher MERGE queries.
No LLM dependency on this side — entities are pre-extracted by Convex.
"""

import os
import redis
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

FALKORDB_HOST = os.environ.get("FALKORDB_HOST", "localhost")
FALKORDB_PORT = int(os.environ.get("FALKORDB_PORT", "6379"))


def get_redis() -> redis.Redis:
    return redis.Redis(host=FALKORDB_HOST, port=FALKORDB_PORT, decode_responses=True)


def escape(value: str) -> str:
    """Escape a string for safe Cypher embedding."""
    return value.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')


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
        closet_cypher = (
            f"MERGE (c:Closet {{id: '{escape(body.closet_id)}'}}) "
            f"ON CREATE SET c.wing = '{escape(body.wing)}', "
            f"c.room = '{escape(body.room)}', "
            f"c.title = '{escape(body.title[:200])}' "
            f"RETURN c"
        )
        r.execute_command("GRAPH.QUERY", graph, closet_cypher)

        # 2. MERGE each entity + link to closet.
        for entity in body.entities:
            if not entity.name.strip():
                continue

            entity_cypher = (
                f"MERGE (e:Entity {{name: '{escape(entity.name)}'}}) "
                f"ON CREATE SET e.type = '{escape(entity.type)}', e.occurrences = 1 "
                f"ON MATCH SET e.occurrences = e.occurrences + 1 "
                f"WITH e "
                f"MATCH (c:Closet {{id: '{escape(body.closet_id)}'}}) "
                f"MERGE (c)-[:MENTIONS]->(e)"
            )
            r.execute_command("GRAPH.QUERY", graph, entity_cypher)
            entities_created += 1

            # Aliases as separate property array.
            if entity.aliases:
                aliases_str = ", ".join(f"'{escape(a)}'" for a in entity.aliases[:5])
                alias_cypher = (
                    f"MATCH (e:Entity {{name: '{escape(entity.name)}'}}) "
                    f"SET e.aliases = [{aliases_str}] "
                    f"RETURN e"
                )
                r.execute_command("GRAPH.QUERY", graph, alias_cypher)

        # 3. Create co-occurrence edges (entities mentioned in same closet).
        entity_names = [e.name for e in body.entities if e.name.strip()]
        for i, a in enumerate(entity_names):
            for b in entity_names[i + 1:]:
                cooc_cypher = (
                    f"MATCH (a:Entity {{name: '{escape(a)}'}}), "
                    f"(b:Entity {{name: '{escape(b)}'}}) "
                    f"MERGE (a)-[r:CO_OCCURS]-(b) "
                    f"ON CREATE SET r.count = 1 "
                    f"ON MATCH SET r.count = r.count + 1"
                )
                r.execute_command("GRAPH.QUERY", graph, cooc_cypher)

        # 4. Create explicit relations.
        for rel in body.relations:
            if not rel.from_entity.strip() or not rel.to_entity.strip():
                continue
            rel_type = rel.relation.upper().replace(" ", "_").replace("-", "_")
            rel_type = "".join(c for c in rel_type if c.isalnum() or c == "_") or "RELATED_TO"

            rel_cypher = (
                f"MATCH (a:Entity {{name: '{escape(rel.from_entity)}'}}), "
                f"(b:Entity {{name: '{escape(rel.to_entity)}'}}) "
                f"MERGE (a)-[r:{rel_type}]->(b) "
                f"ON CREATE SET r.source_closet = '{escape(body.closet_id)}', r.count = 1 "
                f"ON MATCH SET r.count = r.count + 1"
            )
            r.execute_command("GRAPH.QUERY", graph, rel_cypher)
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
    """Search entities by name pattern, return their closets + neighbors."""
    graph = _resolve_graph(body.palace_id, body.graph_name)
    if not graph:
        return {"status": "error", "detail": f"unknown palace_id: {body.palace_id}"}
    r = get_redis()

    try:
        query_esc = escape(body.query.lower())
        cypher = (
            f"MATCH (e:Entity) "
            f"WHERE toLower(e.name) CONTAINS '{query_esc}' "
            f"OPTIONAL MATCH (c:Closet)-[:MENTIONS]->(e) "
            f"RETURN e.name, e.type, e.occurrences, collect(c.id)[..5] AS closets "
            f"ORDER BY e.occurrences DESC "
            f"LIMIT {body.limit}"
        )
        result = r.execute_command("GRAPH.QUERY", graph, cypher)
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
    depth = max(1, min(body.max_depth, 3))

    try:
        name_esc = escape(body.entity_name)
        cypher = (
            f"MATCH path = (start:Entity {{name: '{name_esc}'}})-[*1..{depth}]-(connected) "
            f"RETURN DISTINCT connected.name, connected.type, connected.occurrences "
            f"LIMIT 50"
        )
        result = r.execute_command("GRAPH.QUERY", graph, cypher)
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
        # Extract column names from header
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
