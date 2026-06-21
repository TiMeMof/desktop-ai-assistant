# Architecture Reading Protocol

Use this file when you need project context with the fewest tokens.

## Reading Order

1. Read `struct/architecture.md`.
   - This gives the runtime shape, boundaries, and module index.

2. Read only the module file related to your task:
   - UI/settings/action rendering: `struct/modules/frontend.md`
   - Native desktop/input/mouse/clipboard/window: `struct/modules/tauri-rust.md`
   - FastAPI endpoints/request lifecycle: `struct/modules/daemon.md`
   - YAML/settings/env/schema ownership: `struct/modules/config.md`
   - Model platforms/provider protocol: `struct/modules/providers.md`
   - Prompt injection/memory/context: `struct/modules/prompt-memory.md`
   - Live2D/presentation event protocol: `struct/modules/live2d.md`

3. Read `struct/todo.md` only when planning roadmap, cleanup, or prioritization.

4. Read source files only after the relevant architecture module identifies them.

## Writing Rule

When changing architecture:

- Update `struct/architecture.md` only for top-level runtime shape, boundaries, or module index changes.
- Update the relevant `struct/modules/*.md` for module-level behavior.
- Update `struct/todo.md` for future work, known gaps, or deferred decisions.
- Keep `README.md` focused on usage, install, run, verify.

## Token Budget Rule

For small tasks, read:

```text
struct/architecture.md
one relevant struct/modules/*.md
the exact source files referenced by that module
```

For cross-cutting tasks, read:

```text
struct/architecture.md
all affected struct/modules/*.md
struct/todo.md if the task changes roadmap or priorities
```

Avoid reading every source file upfront unless the task explicitly spans the whole app.
