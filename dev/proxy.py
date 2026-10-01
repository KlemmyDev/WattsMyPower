"""
Serve this checkout's dashboard (static/) with the API passed through to a
running WattsMyPower, so UI changes can be tried against live data without a
second poller talking to the inverters (they cope badly with two clients).

    python3 dev/proxy.py http://<server IP>:8080 [--port 8081] [--allow-writes]

Only the frontend comes from this checkout: API or backend changes need a deploy
to the upstream to show up. Requests that change things upstream (PUT/POST/DELETE,
e.g. saving rates or the system cost) are refused unless --allow-writes is given,
so testing here can't alter the live service by accident. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "static"
PASS_HEADERS = ("Content-Type", "Content-Disposition", "Cache-Control")


class Handler(BaseHTTPRequestHandler):
    upstream = ""
    allow_writes = False

    def log_message(self, fmt, *args):  # quieter than the default: skip static files and the live stream
        if self.path.startswith("/api/") and not self.path.startswith("/api/stream"):
            super().log_message(fmt, *args)

    # ---- static files from this checkout
    def _static(self) -> None:
        rel = "index.html" if self.path.split("?")[0] == "/" else self.path.split("?")[0][len("/static/"):]
        path = (STATIC / rel).resolve()
        if STATIC not in path.parents or not path.is_file():
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")  # always pick up edits on reload
        self.end_headers()
        self.wfile.write(body)

    # ---- API passed through to the upstream
    def _proxy(self, method: str) -> None:
        data = None
        if method in ("PUT", "POST", "DELETE"):
            if not self.allow_writes:
                self._json(403, {"detail": "This is a dev server reading from the live service, so changes are blocked. "
                                           "Restart dev/proxy.py with --allow-writes to save them to the live service."})
                return
            data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        req = urllib.request.Request(self.upstream + self.path, data=data, method=method,
                                     headers={k: v for k, v in self.headers.items() if k in ("Content-Type", "Accept")})
        stream = self.path.startswith("/api/stream")
        try:
            resp = urllib.request.urlopen(req, timeout=None if stream else 60)
        except urllib.error.HTTPError as e:
            resp = e
        except OSError as e:
            self._json(502, {"detail": f"Could not reach {self.upstream} ({e})."})
            return
        with resp:
            self.send_response(resp.status)
            for h in PASS_HEADERS:
                if resp.headers.get(h):
                    self.send_header(h, resp.headers[h])
            if stream:
                # Server-sent events: forward each line as it arrives.
                self.end_headers()
                try:
                    for line in resp:
                        self.wfile.write(line)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            body = resp.read()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def _json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self, method: str) -> None:
        if self.path.startswith("/api/") or self.path.startswith("/healthz"):
            self._proxy(method)
        elif method == "GET":
            self._static()
        else:
            self.send_error(405)

    def do_GET(self):
        self._route("GET")

    def do_PUT(self):
        self._route("PUT")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("upstream", help="URL of the running WattsMyPower, e.g. http://192.168.1.50:8080")
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--allow-writes", action="store_true", help="pass PUT/POST/DELETE through to the upstream")
    args = ap.parse_args()
    Handler.upstream = args.upstream.rstrip("/")
    Handler.allow_writes = args.allow_writes
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    print(f"Dashboard from {STATIC} on http://localhost:{args.port}, API from {Handler.upstream}"
          f"{'' if args.allow_writes else ' (changes blocked)'}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
