"""P2 — bridge external-denial emit (piece #3). Offline, no live backend required.
Run: python3 services/test_external_denial_emit.py

Proves the bridge's best-effort emit contract: no-op when the sink is unset, posts the right payload
to /external-denial with the shared key, and SWALLOWS any failure (the client already got its 403, so
the audit emit must never block or raise). The Convex sink + the full denialsByLayer chain are proven
live separately (curl + denialsByLayer falkordb count)."""
import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import graphiti_bridge as gb  # noqa: E402


def test_noop_when_sink_unset():
    gb.cfg.denial_sink_url = ""
    gb._emit_external_denial("pX", {"reason": "x"})   # must not raise, no network
    print("PASS test_noop_when_sink_unset")


def test_posts_expected_payload():
    captured = {}

    class _Resp:
        def close(self):
            pass

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["key"] = req.get_header("X-palace-key")
        captured["body"] = json.loads(req.data.decode())
        return _Resp()

    gb.cfg.denial_sink_url = "http://sink.example"
    gb.cfg.api_key = "secret"
    orig = gb.urllib.request.urlopen
    gb.urllib.request.urlopen = fake_urlopen
    try:
        gb._emit_external_denial("pX", {
            "denied_at_layer": "falkordb", "reason": "cross_tenant",
            "palace_id": "pX", "claimed_tenant": "acme", "claimed_seat": "bob"})
    finally:
        gb.urllib.request.urlopen = orig
    assert captured["url"] == "http://sink.example/external-denial", captured["url"]
    assert captured["key"] == "secret"
    b = captured["body"]
    assert b["deniedAtLayer"] == "falkordb"
    assert b["palaceId"] == "pX"
    assert b["neopId"] == "bob"            # claimed_seat preferred over tenant
    assert b["reason"] == "cross_tenant"
    assert "claimed_tenant" in b["extra"]  # full denial preserved for forensics
    print("PASS test_posts_expected_payload")


def test_swallows_errors():
    # An unreachable sink must be logged-and-swallowed, never raised (best-effort).
    gb.cfg.denial_sink_url = "http://127.0.0.1:1"
    gb.cfg.api_key = "k"
    gb._emit_external_denial("pX", {"denied_at_layer": "falkordb", "reason": "x"})
    gb.cfg.denial_sink_url = ""            # reset module state
    print("PASS test_swallows_errors")


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            f()
    print("ALL EXTERNAL-DENIAL EMIT TESTS PASS")
