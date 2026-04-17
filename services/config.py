"""Bridge configuration.

Environment variables:
  PALACE_BRIDGE_API_KEY   — shared secret for auth (required in production)
  FALKORDB_HOST           — FalkorDB hostname (default: localhost)
  FALKORDB_PORT           — FalkorDB port (default: 6379)
  ANTHROPIC_API_KEY       — for Graphiti's internal entity extraction
  VOYAGEAI_API_KEY        — for Graphiti's internal embeddings (optional, falls back to Anthropic)
  GRAPHITI_LLM_MODEL      — model for graph extraction (default: claude-haiku-4-5-20251001)
  BRIDGE_LOG_DIR          — log directory (default: /var/log/graphiti-bridge)
  BRIDGE_MAX_CLIENTS      — max Graphiti clients in pool (default: 10)
  BRIDGE_REQUEST_TIMEOUT  — per-request timeout in seconds (default: 60)
  BRIDGE_ENV              — "production" or "development" (default: production)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class BridgeConfig:
    api_key: str = ""
    falkordb_host: str = "localhost"
    falkordb_port: int = 6379
    anthropic_api_key: str = ""
    voyageai_api_key: str = ""
    graphiti_llm_model: str = "claude-haiku-4-5-20251001"
    log_dir: str = "/var/log/graphiti-bridge"
    max_clients: int = 10
    request_timeout: int = 60
    env: str = "production"

    @classmethod
    def from_env(cls) -> "BridgeConfig":
        return cls(
            api_key=os.environ.get("PALACE_BRIDGE_API_KEY", ""),
            falkordb_host=os.environ.get("FALKORDB_HOST", "localhost"),
            falkordb_port=int(os.environ.get("FALKORDB_PORT", "6379")),
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
            voyageai_api_key=os.environ.get("VOYAGEAI_API_KEY", ""),
            graphiti_llm_model=os.environ.get(
                "GRAPHITI_LLM_MODEL", "claude-haiku-4-5-20251001"
            ),
            log_dir=os.environ.get("BRIDGE_LOG_DIR", "/var/log/graphiti-bridge"),
            max_clients=int(os.environ.get("BRIDGE_MAX_CLIENTS", "10")),
            request_timeout=int(os.environ.get("BRIDGE_REQUEST_TIMEOUT", "60")),
            env=os.environ.get("BRIDGE_ENV", "production"),
        )

    @property
    def auth_enabled(self) -> bool:
        return bool(self.api_key)


# ── Palace registry ──────────────────────────────────────────────
#
# Maps palace_id → FalkorDB graph name. Callers pass palace_id only;
# the bridge derives the graph name. This prevents cross-tenant graph
# pollution (Tier 1 fix from analysis).
#
# In production, load from a config file or from Convex at startup.
# For now, hardcoded — extend via PALACE_REGISTRY_FILE env var.

_DEFAULT_REGISTRY: dict[str, str] = {
    "neuraledge": "palace_neuraledge_hq",
    "zoo_media": "palace_zoo_media",
}


@dataclass
class PalaceRegistry:
    _palaces: dict[str, str] = field(default_factory=lambda: dict(_DEFAULT_REGISTRY))

    def graph_for(self, palace_id: str) -> str | None:
        return self._palaces.get(palace_id)

    def register(self, palace_id: str, graph_name: str) -> None:
        self._palaces[palace_id] = graph_name

    def unregister(self, palace_id: str) -> None:
        self._palaces.pop(palace_id, None)

    def all(self) -> dict[str, str]:
        return dict(self._palaces)

    @classmethod
    def load(cls) -> "PalaceRegistry":
        registry = cls()
        # Extend from env if provided (JSON file path)
        path = os.environ.get("PALACE_REGISTRY_FILE")
        if path and os.path.isfile(path):
            import json

            with open(path) as f:
                extra = json.load(f)
            for pid, gname in extra.items():
                registry.register(pid, gname)
        return registry
