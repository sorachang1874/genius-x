# tools/ — Python offline / experiment layer

Python lives **here only**, deliberately separate from the Node/TS main application. This
is the "experiment and offline tooling" tier — it must never sit on the live classroom
request path. If an AI capability here matures into a runtime dependency, promote it to a
proper Python *service* with its own contract; don't smuggle it into the main pipeline.

## What goes here

| Dir | Purpose |
| --- | --- |
| `prompt-eval/` | Batch prompt evaluation, regression comparison across template versions |
| `content-analysis/` | Course content quality analysis, transcript/memory-extraction review |
| `safety-experiments/` | Safety classifier experiments, filter tuning (offline) |
| `notebooks/` | Jupyter experiments, model comparison, ad-hoc analysis |

## Setup

```sh
cd tools
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"        # installs ruff/pytest/jupyter when you need them
```

`.venv/` is git-ignored. Secrets come from environment / `.env` (never committed).
