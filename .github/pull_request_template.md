## Summary

<!-- What changes for people using it first, then notable implementation notes. Link the issue it fixes ("Fixes #123"). -->

-

## Test plan

<!-- Tick only what you actually ran. Leave the rest unticked and say why. -->

- [ ] `uv run ruff check .` and `uv run ruff format --check .`
- [ ] `uv run mypy`
- [ ] `uv run pytest`
- [ ] `npm --prefix web run typecheck`, `lint`, `format:check` and `build`
- [ ] Tried in the dashboard (against `MOCK=1`, or real hardware: say which)
