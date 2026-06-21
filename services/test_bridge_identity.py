"""P2 — FalkorDB-bridge L2 tenant-scope enforcement. Offline, stdlib only (no pytest/FalkorDB).
Run: python3 services/test_bridge_identity.py"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from bridge_identity import verify_tenant_scope, parse_identity, DENIED_AT_LAYER  # noqa: E402


class FakeRegistry:
    def __init__(self, ids): self.ids = set(ids)
    def graph_for(self, pid): return ("graph_" + pid) if pid in self.ids else None


REG = FakeRegistry(["neuraledge", "zoo_media"])


def test_parse_identity():
    assert parse_identity("neuraledge:aria") == ("neuraledge", "aria")
    assert parse_identity("neuraledge") == ("neuraledge", None)
    assert parse_identity("") == (None, None)
    assert parse_identity(None) == (None, None)
    print("PASS test_parse_identity")


def test_own_tenant_allowed():
    ok, denial = verify_tenant_scope("neuraledge", "neuraledge:aria", REG)
    assert ok and denial is None
    print("PASS test_own_tenant_allowed")


def test_cross_tenant_denied_emits_falkordb():
    ok, d = verify_tenant_scope("zoo_media", "neuraledge:aria", REG)
    assert not ok
    assert d["denied_at_layer"] == DENIED_AT_LAYER == "falkordb"
    assert d["reason"] == "cross_tenant" and d["claimed_tenant"] == "neuraledge"
    print("PASS test_cross_tenant_denied_emits_falkordb")


def test_missing_identity_denied():
    ok, d = verify_tenant_scope("neuraledge", None, REG)
    assert not ok and d["reason"] == "missing_neop_identity" and d["denied_at_layer"] == "falkordb"
    print("PASS test_missing_identity_denied")


def test_unknown_palace_denied():
    ok, d = verify_tenant_scope("acme", "acme:x", REG)
    assert not ok and d["reason"] == "unknown_palace" and d["denied_at_layer"] == "falkordb"
    print("PASS test_unknown_palace_denied")


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            f()
    print("ALL BRIDGE-IDENTITY TESTS PASS")
