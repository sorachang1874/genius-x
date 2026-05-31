# @genius-x/course-config

Lesson content as **configuration, not code**. Adding Lesson 2-16 should mean adding a
JSON file here — never editing the course engine (PRD §4.2).

> Agent owner: shared with **Agent E**. Validated against the course-config schema in
> `@genius-x/contracts`.

## Layout

```
lessons/
  lesson-001.json    # 认识我的 AI 好朋友 (the MVP lesson — see docs/product/genius-x-lesson1-rundown.md)
src/
  index.ts           # loader + schema validation entry
```

Each lesson config drives stages, durations, unlock rules, and aiInteraction blocks. The
course engine in `apps/server` reads these; it must stay generic across lessons.
