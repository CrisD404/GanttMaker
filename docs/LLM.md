# GanttMaker — guide for AI agents

GanttMaker is a 100% client-side web app that renders **Gantt charts from plain text** (a small DSL, similar in spirit to Mermaid) and lets people edit them interactively. There is no server and no API: the diagram *is* the text. Use this guide to **write valid GanttMaker diagrams** and to **give the user a link that opens them**.

Use it when the user asks for a project plan, roadmap, timeline, schedule, sprint plan or Gantt chart, or shares a `.gantt` file or a GanttMaker link.

> The app UI is in Spanish. DSL keywords are English. Write task names in the user's language.

## 1. How to answer

1. Write the diagram in a fenced code block tagged `gantt`.
2. Offer an **"open in GanttMaker" link**: `APP_URL#src=` + `encodeURIComponent(diagram)`.
   - `APP_URL` is the address where you found this file, without the file name (for example, if you read `https://example.com/gantt/llms.txt`, use `https://example.com/gantt/`).
   - Percent-encode everything (spaces `%20`, newlines `%0A`, `"` `%22`, `#` `%23`, `@` `%40`).
   - Opening the link creates a **new space** in the user's browser; it never overwrites their other diagrams.
   - Keep links reasonably short (under ~8 000 characters). For bigger plans, give only the code block and tell the user to paste it in the editor.
3. Links created by the app's *Compartir* button use `#code=` (lz-string compressed). If you cannot decompress them, ask the user to copy the code (*Archivo → Copiar código*).

## 2. Minimal example

```gantt
gantt "Website relaunch"
start 2026-11-02

section Design
  Wireframes @Ana 5d
  Visual design @Ana 5d
  Design approved milestone

section Build
  Frontend @Luis 10d after Visual design
  Backend @Marta 8d after Wireframes #crit
  Launch milestone after Frontend, Backend
```

## 3. Syntax reference

One instruction per line. `//` starts a comment. Keywords go at column 0; **tasks are indented** under a `section`.

### Header (all optional)

| Line | Meaning |
|---|---|
| `gantt "Title"` | Diagram title |
| `start 2026-11-02` | Project start (ISO date). Defaults to the earliest task date or today |
| `calendar mon-fri` | Working days: `mon-fri` (default), `mon-sat`, `all`, or a list `mon,tue,thu` |
| `holiday 2026-12-25, 2026-12-31` | Non-working days; ranges allowed: `2026-12-24..2026-12-26` |
| `today 2026-11-15` | Fix the "today" line (otherwise the real date) |
| `sprints 2w from 2026-11-02 "Sprint {n}" first 14` | Sprint cadence. Length in calendar days (`10d`) or weeks (`2w`). `from`, pattern and `first` are optional |
| `sprint "Hardening" 2026-12-01..2026-12-12` | Explicit sprint (also `sprint Name 2026-12-01 1w`). If any explicit sprint exists, the cadence is ignored |

### Owners

```
team Backend #5b5bf7
person Ana @Design #ec4899
person "María José" @Design
```

Declaring owners is optional (`@Name` auto-creates a person). People inherit their team's color. Filtering by a team includes its people.

### Sections

`section Name` (optional color: `section Payments #f59e0b`). Tasks before any section go into an unnamed group.

### Tasks

`Name` followed by attributes **in any order**:

| Attribute | Example | Meaning |
|---|---|---|
| Owner(s) | `@Ana @Backend` | Person or team; several allowed |
| Duration | `5d`, `2w` | **Working** days / weeks (skips weekends and holidays) |
| Start | `2026-11-10` | Explicit start (moves to the next working day) |
| Start..end | `2026-11-10..2026-11-20` | Exact range, end inclusive |
| Dependencies | `after Design, API` | Starts when **all** listed tasks finish |
| Milestone | `milestone` (or `0d`) | A point in time (diamond) |
| Progress | `60%` | 0–100 |
| Status | `#done` `#active` `#blocked` | `100%` also means done |
| Critical | `#crit` | Red outline; arrows between critical tasks are red |
| Tag | `#mobile` | Free label, used by filters |
| Color | `#f59e0b` or `#f90` | Bar color override |
| Id | `id:auth` | Short reference for `after` |

Rules:

- The **name ends at the first attribute**. If a name contains something that looks like an attribute (`2d`, `50%`, `@`, `#`, a date, the words `after`/`milestone`) or a comma, **quote it**: `"Phase 2d review" 3d`.
- No date and no `after` → the task **starts when the previous task of the same group ends**. The first task of each section starts at `start`.
- No duration → 1 day.
- Date **and** `after` → "not earlier than": starts at the later of the two.
- **Subtasks**: indent deeper. A parent's dates are computed from its children — do **not** give parents a duration.
- `after` references match a task **name exactly** (case-insensitive) or its `id:`. Every reference must exist; no cycles; a task cannot depend on its own parent or child.
- Avoid duplicate task names (or give them `id:`).

### Views and level of detail

Settings can be written at top level (the main view, *Principal*) or inside an indented `view` block, which inherits the main view and overrides what it sets. Each view is a tab in the app.

```
scale week

view Executive
  scale month
  detail sections
  columns none
  hide avatars, deps

view Backend team
  filter @Backend
  columns owner, start, end, duration, progress

view Risks
  filter #crit #blocked
  color status
```

| Setting | Values |
|---|---|
| `scale` | `day` `week` `sprint` `month` `quarter` `year` (auto if omitted) |
| `detail` | `sections` `tasks` `subtasks` `all` or a number. Hidden levels are summarized in the parent bar (with their milestones) |
| `columns` | `owner` `start` `end` `duration` `progress` or `none` |
| `show` / `hide` | `deps` `today` `weekends` `progress` `avatars` `labels` `grid` `sprints` or `all` |
| `density` | `compact` `normal` `comfortable` |
| `color` | `owner` `section` `status` |
| `filter` | `@owner` `#tag` `"text"` (owners AND tags AND text) |
| `range` | `2026-11-01..2026-12-31` |

## 4. Recipes

- **Roadmap for executives**: a `view` with `scale quarter` or `month`, `detail sections`, `columns none`.
- **Sprint plan**: `sprints 2w "Sprint {n}" first N` + `scale sprint`; group work by epic using sections.
- **Per-team plan**: one `view` per team with `filter @Team`.
- **Status report**: `color status` and `#done` / `#active` / `#blocked` on tasks, plus `NN%` progress.
- **Fixed deadlines**: milestones with explicit dates (`Launch milestone 2026-12-18`) and `#crit` on the tasks that lead to them.

## 5. Checklist before answering

1. Every `after` name exists **exactly** (copy-paste the names).
2. Tasks are indented under a `section`; keywords are at column 0.
3. Dates are valid ISO (`YYYY-MM-DD`).
4. Names that contain attribute-like tokens or commas are quoted.
5. Parents (tasks with subtasks) have no duration of their own.
6. Durations are in **working** days unless the calendar is `all`.
7. Give the code block **and**, if short enough, the `#src=` link.

## 6. Larger example

```gantt
gantt "Mobile app launch"
start 2026-10-05
calendar mon-fri
holiday 2026-12-08, 2026-12-25

team Product #8b5cf6
team Backend #5b5bf7
team Mobile #14b8a6
person Ana @Product
person Luis @Backend
person Sofía @Mobile

section Discovery
  User interviews @Ana 5d #done
  Market benchmark @Ana 3d #done
  Scope definition @Product 2d after User interviews, Market benchmark 100%
  Scope approved milestone

section Development
  API
    Data model @Luis 3d after Scope approved
    Authentication @Luis 5d #crit
    Payment endpoints @Luis 8d #crit
  App
    Navigation @Sofía 5d after Scope approved
    Main screens @Sofía 10d
    API integration @Sofía 5d after Payment endpoints #crit
  Internal beta milestone after API, App

section Launch
  QA and bug fixing @Mobile 8d after Internal beta #crit
  Store release @Mobile 3d #crit
  Go live milestone

view Executive
  scale month
  detail sections
  columns none
```
