"""FalkorDB-bridge L2 — tenant-scope enforcement + denied_at_layer=falkordb (P2).

Closes the L2 gap: the shared `X-Palace-Key` authenticates the DISPATCHER but does NOT bind a
caller to a TENANT — so a key-holder could pass another tenant's palace_id and reach its graph.
This requires an `X-NEop-Identity` (tenant[/seat]) and refuses any request whose palace_id is not
the identity's tenant, emitting a `denied_at_layer=falkordb` record (→ Convex recordExternalDenial;
the live emit is the wiring step). TENANT-level only — graph SEAT-isolation stays deferred (Gate D).

In this bridge `palace_id` IS the tenant key (PalaceRegistry maps tenant→graph_name), so the check
is `identity_tenant == palace_id`. Pure + offline-gradeable; signing (HMAC/Ed25519 over the header)
is production hardening layered on top of this decision.
"""
from __future__ import annotations
from typing import Optional, Tuple

DENIED_AT_LAYER = "falkordb"


def parse_identity(header: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """`X-NEop-Identity` = '<tenant>:<seat>' (seat optional). Returns (tenant, seat) or (None, None)."""
    if not isinstance(header, str) or not header.strip():
        return None, None
    parts = header.strip().split(":", 1)
    tenant = parts[0].strip() or None
    seat = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
    return tenant, seat


def _denial(palace_id, tenant, seat, reason) -> dict:
    return {
        "denied_at_layer": DENIED_AT_LAYER,
        "reason": reason,
        "palace_id": palace_id,
        "claimed_tenant": tenant,
        "seat": seat,
    }


def verify_tenant_scope(palace_id: str, identity_header: Optional[str], registry):
    """Decide whether a graph op on `palace_id` is in the caller's tenant scope.

    Returns (allowed: bool, denial: dict | None). The denial carries denied_at_layer=falkordb so
    the audit's `falkordb` slot finally emits (today it is plumbed-but-silent in denialsByLayer).
    """
    tenant, seat = parse_identity(identity_header)
    if registry.graph_for(palace_id) is None:
        return False, _denial(palace_id, tenant, seat, "unknown_palace")
    if tenant is None:
        return False, _denial(palace_id, tenant, seat, "missing_neop_identity")
    if tenant != palace_id:
        # A valid dispatcher key, but a tenant that does not own the requested graph.
        return False, _denial(palace_id, tenant, seat, "cross_tenant")
    return True, None
