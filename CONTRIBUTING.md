# Contributing to WattsMyPower

Thanks for helping. Bug reports, new inverter models and pull requests are all welcome. For anything bigger than a
fix, open an issue first so we can agree on the approach before you spend time on it.

Found a security problem? Don't open an issue: see [SECURITY.md](SECURITY.md).

## Setting up

You need [uv](https://docs.astral.sh/uv/) (it fetches Python 3.13 by itself) and Node.js 22 or later (the Docker image
uses 24).

```bash
git clone https://github.com/KlemmyDev/WattsMyPower.git
cd WattsMyPower
uv sync                 # the dashboard, the collector and the dev tools, from uv.lock
npm --prefix web ci     # the dashboard's web app, from web/package-lock.json
```

Then run it without an inverter, on simulated readings (keep mock data in its own files so it never mixes with real
data):

```bash
npm --prefix web run build                     # the backend serves web/dist
MOCK=1 DB_PATH=./data/mock.db uv run uvicorn app.main:app --port 8080
```

and open `http://localhost:8080`. For the web app with hot reload, run `npm run dev` in `web/` alongside it (see
[web/README.md](web/README.md)). The README's [Local development](README.md#local-development) section covers
following a real collector, and a simulated one.

## Checks

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs these on every pull request, and they all need to pass.
Run them before you push:

```bash
# Python: the dashboard (app/) and the collector (collector/)
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest

# The web app
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix web run format:check
npm --prefix web run build
```

`uv run ruff format .` and `npm --prefix web run format` fix formatting. CI also builds both Docker images
(`docker build --target collector .` and `docker build --target api .`) for amd64 and arm64.

Add or update tests in `tests/` for behaviour you change. Don't skip or loosen a test to get it passing.

## Adding an inverter

Each inverter model is a driver with two halves: a reader in the collector that fetches raw registers, and a decoder
in the dashboard that turns them into readings. The README's [Supported inverters](README.md#supported-inverters)
section explains how they fit together and where each half goes. If you'd like a model supported but can't write the
driver, open a **New inverter or hardware** issue with its model, type code and what it reports.

The collector is the only thing that talks to the inverters, and it rarely changes, so keep changes there small. Never
write to an inverter's registers from anywhere else.

## Style

- Match the code around you: its naming, its comments and its docstrings.
- Words people read in the dashboard are plain, friendly Australian English without jargon ("The battery keeps 30%
  until 6am."), in sentence case. Point to places the way the navigation names them: **Manage → System**.
- Python is formatted by ruff (120 columns) and type-checked by mypy. The web app is formatted by Prettier and linted
  by ESLint; [web/README.md](web/README.md) has its conventions.

## Commits and pull requests

- Branch from `main` (`feat/…` for something new, `fix/…` for a fix).
- Write the commit's first line as what changes for the person using it, in a plain sentence
  ("Outage feeds are fetched every 12 to 18 minutes, at random, not on the dot of 15"). The body says why, and any
  details worth keeping.
- Open the pull request against `main`. The template asks for a **Summary** (what changes for people using it first,
  then notable implementation notes) and a **Test plan** (tick only what you actually ran).
- Merging to `main` releases it on the nightly channel, so `main` should always be safe to install.
