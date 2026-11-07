#!/usr/bin/env python3
"""Regenerate NexMap's brand assets with VectorCraft (docs/brand/README.md).

The marks are hand-authored SVG in docs/brand/. VectorCraft turns them into the
shipped files: it outlines the wordmark (Inter SemiBold) so the lockups look the
same everywhere, and renders every PNG icon and the social card.

1. Start VectorCraft with its local control server, allowed to read the repo and
   write only where the outputs go:

     open -a VectorCraft --args --control 7979 \\
       --automation-read-root "$PWD" \\
       --automation-write-root "$PWD/docs/brand" --automation-write-root "$PWD/public"

2. From the repo root:  python3 scripts/brand-export.py

The control server listens on 127.0.0.1 only. Nothing here touches the network.
"""
import json
import shutil
import socket
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "docs" / "brand"
PUBLIC = ROOT / "public"
PORT = 7979


class VectorCraft:
    """A minimal client for VectorCraft's JSON-lines control protocol."""

    def __init__(self, port: int = PORT):
        try:
            self.sock = socket.create_connection(("127.0.0.1", port), timeout=90)
        except OSError:
            sys.exit(f"VectorCraft isn't listening on port {port}; start it as shown at the top of this file.")
        self.io = self.sock.makefile("rw", encoding="utf-8")
        self.next_id = 0

    def call(self, method: str, **params):
        self.next_id += 1
        self.io.write(json.dumps({"id": self.next_id, "method": method, "params": params}) + "\n")
        self.io.flush()
        reply = json.loads(self.io.readline())
        if not reply.get("ok"):
            raise RuntimeError(f"{method}: {reply.get('error')}")
        return reply.get("result")

    def command(self, command: str, **params):
        return self.call("engine.execute", command=command, params=params)

    def open_fresh(self, path: Path):
        """Open one file as the only document, so commands can't hit a stale tab."""
        self.command("file.closeAll")
        result = self.call("app.open", path=str(path))
        if result.get("warnings"):
            print(f"  import warnings for {path.name}: {result['warnings']}")

    def require_fonts(self):
        """Fail loudly rather than outline a substituted font."""
        off = [f for f in self.command("text.fonts") if f["status"] != "exact"]
        if off:
            sys.exit(f"Missing fonts in VectorCraft: {off}. The wordmark uses Inter SemiBold.")


def wait_for(path: Path, since: float):
    """Exports run in the background; wait until the file has been rewritten."""
    for _ in range(100):
        if path.exists() and path.stat().st_mtime >= since:
            return
        time.sleep(0.1)
    sys.exit(f"Timed out waiting for {path}")


def main():
    vc = VectorCraft()

    # Lockups: outline the wordmark, save plain SVG.
    for tone in ("light", "dark"):
        vc.open_fresh(BRAND / "src" / f"lockup-{tone}.svg")
        vc.require_fonts()
        vc.command("select.all")
        vc.command("type.createOutlines")
        out = BRAND / f"nexmap-lockup-{tone}.svg"
        start = time.time()
        vc.call("app.save", path=str(out), svg={"decimals": 2, "outlineText": True, "styling": "presentation"})
        wait_for(out, start)
        print(f"  {out.relative_to(ROOT)}")

    # Icons and the social card.
    renders = [
        ("nexmap-mark.svg", "icon-192.png", 192, "transparent"),
        ("nexmap-mark.svg", "icon-512.png", 512, "transparent"),
        ("nexmap-icon-maskable.svg", "icon-maskable-512.png", 512, "#060a16"),
        # iOS rounds the corners itself, so its icon is the full-bleed one.
        ("nexmap-icon-maskable.svg", "apple-touch-icon.png", 180, "#060a16"),
        ("src/og-card.svg", "og.png", 1200, "#05080f"),
    ]
    for source, name, width, background in renders:
        vc.open_fresh(BRAND / source)
        if source.startswith("src/"):
            vc.require_fonts()
        out = PUBLIC / name
        start = time.time()
        vc.call("app.export", path=str(out), format="png", width=width, background=background)
        wait_for(out, start)
        print(f"  {out.relative_to(ROOT)}")

    # The SVG icons ship as authored.
    shutil.copyfile(BRAND / "nexmap-mark.svg", PUBLIC / "icon.svg")
    shutil.copyfile(BRAND / "nexmap-mark-small.svg", PUBLIC / "favicon.svg")
    print("  public/icon.svg, public/favicon.svg")


if __name__ == "__main__":
    main()
