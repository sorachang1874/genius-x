# @genius-x/web

Student and assistant client — one React PWA (runs in the iPad browser), **role-separated
internally** rather than split into two apps (per PRD §2: "same app, role-distinguished").
It can be split into separate apps later if needed.

> Agent owners: **Agent A (assistant/control surface)** and **Agent B (student classroom)**
> work in different subdirectories below, so they can run in parallel.

## Layout

```
src/
  student/    # Agent B — child-facing classroom flow (I-T-O interactions, canvas, mic, birth cert)
  assistant/  # Agent A — assistant unlock controls, teacher projection trigger
  shared/     # shared UI, WebSocket client, contracts-typed API client
public/       # static assets (e.g. the white clay "魔法泥人" placeholder)
```

## Hard product rules that bind the UI (see manifesto + PRD §0)

- No "Prompt / LLM / token / AI" wording on screen. The companion is a friend, not a tool.
- Every input gets a positive output — **no failure/error state visible to the child**.
- API latency is dressed as "AI is thinking" (animation), never a blank wait.
- Framework (Vite + React PWA) to be added at build time — recommended, confirm before installing.
