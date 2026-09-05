# Issue Tracker: GitHub

Issues and specs for this repo live in GitHub Issues for `goorock2024AI/aiwei-gallery`. Use the `gh` CLI for issue tracker operations from inside this clone.

## Conventions

- Create an issue: `gh issue create --title "..." --body "..."`
- Read an issue: `gh issue view <number> --comments`
- List issues: `gh issue list --state open --json number,title,body,labels,comments`
- Comment on an issue: `gh issue comment <number> --body "..."`
- Apply or remove labels: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- Close an issue: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside the clone.

## Pull Requests As A Triage Surface

PRs as a request surface: no.

## Skill Meanings

When a skill says "publish to the issue tracker", create a GitHub issue.

When a skill says "fetch the relevant ticket", run `gh issue view <number> --comments`.

## Wayfinding Operations

Used by `wayfinder`. The map is a single issue with child issues as tickets.

- Map: a single issue labelled `wayfinder:map`, holding notes, decisions so far, and open questions.
- Child ticket: an issue linked to the map as a GitHub sub-issue when available. If sub-issues are unavailable, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body.
- Ticket labels: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Blocking: use GitHub native issue dependencies when available. If unavailable, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body.
- Claim: assign the ticket to the driving developer.
- Resolve: comment with the result, close the issue, then append a short decision pointer to the map.
