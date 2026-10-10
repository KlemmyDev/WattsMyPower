"""
Serves the dashboard: a single-page app built from web/ (npm run build) into web/dist/client.
Hashed assets are cached for good; every other path gets the app shell, and the
client-side router shows the right page.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.security import inline_scripts, page_policy

WEB = Path(__file__).resolve().parents[2] / "web" / "dist" / "client"


class ImmutableStatic(StaticFiles):
    """Build output with content-hashed names, so browsers can keep it forever."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


def mount_spa(app: FastAPI, web: Path = WEB) -> None:
    """Register last: it answers every path the API routes don't."""
    app.mount("/assets", ImmutableStatic(directory=web / "assets", check_dir=False), name="assets")
    # The page's Content Security Policy, allowing the scripts written into it; read again when it's rebuilt.
    policy: dict[tuple[int, int], str] = {}

    def shell_policy(shell: Path) -> str:
        st = shell.stat()
        key = (st.st_mtime_ns, st.st_size)
        if key not in policy:
            policy.clear()
            policy[key] = page_policy(inline_scripts(shell.read_text(encoding="utf-8")))
        return policy[key]

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        shell = web / "_shell.html"
        if not shell.is_file():
            raise HTTPException(status_code=503, detail="The dashboard hasn't been built. Run `npm run build` in web/.")
        # Files at the top of the build (none today, but e.g. robots.txt) are served as they are.
        file = (web / path).resolve()
        if path and web in file.parents and file.is_file():
            return FileResponse(file, headers={"Cache-Control": "no-cache"})
        return FileResponse(
            shell, headers={"Cache-Control": "no-cache", "Content-Security-Policy": shell_policy(shell)}
        )
