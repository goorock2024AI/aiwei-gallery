# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before Exploring

Read these when they exist and are relevant to the task:

- `CONTEXT.md` at the repo root
- `CONTEXT-MAP.md` at the repo root, if the repo later switches to a multi-context layout
- `docs/adr/` for decisions that touch the area being changed

If these files do not exist, proceed silently. The `domain-modeling`, `grill-with-docs`, and `improve-codebase-architecture` skills can create or refine them when terms or decisions are resolved.

## File Structure

This repo uses a single-context layout:

```text
/
|-- CONTEXT.md
|-- docs/
|   `-- adr/
`-- ...
```

## Vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, test name, or implementation note, use the term as defined in `CONTEXT.md`.

If the needed concept is missing from the glossary, either reconsider whether the project already has better language for it or note the gap for `domain-modeling`.

## ADR Conflicts

If output contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
