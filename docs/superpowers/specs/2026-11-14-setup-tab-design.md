# Setup tab and deterministic settings: design

Date: 2026-11-14. Status: approved in chat (2026-11-14), not implemented. Target release: 0.5.0.

Supersedes:

1. [Checkup](2026-11-04-checkup-design.md) as a whole. The Checkup tab is removed.
2. [Shared ontology](2026-11-11-shared-ontology-design.md), sections on the Metrics section of Checkup, the AI build, rebuild proposals and the industry setting.
3. [Ontology model](2026-11-04-ontology-model-design.md), the Metrics tab and the AI interpretation of the Metrics tables.

## Goal

A person who isn't a data specialist can finish the Gyroscope setup on one page. A data analyst sits with a business user, reads each question aloud, and fills the answer in. Every setting is stored as chosen. The AI only recommends.

## What the user asked for

1. One setup flow covers everything Checkup and Metrics cover today.
2. It works the same for a brand-new project and for editing an existing one.
3. Settings are saved at the project level, deterministically. The AI never calculates a saved value.
4. Settings are grouped by importance, styled like the data quality checks: error (blocker), warning (highly recommended), notice.
5. Only the critical number and the date field of its Data Mart block the canvas.
6. Each setting shows its current value. When a recommendation differs, it shows next to the current value. A fast AI model computes the recommendations that code can't decide.
7. Each setting and each block has:
   1. a business title, such as "Business Critical Number"
   2. the question it answers, as the subtitle, such as "What is the main business goal?"
   3. one sentence on why it matters, next to the question, such as "To show the trend line and tell whether the number grows or declines" for the date field
   4. answer options, one of them recommended
8. A single progress bar on top shows how many errors (red), warnings (yellow) and notices (green) are left.
9. Gyroscope suggests ratio metrics between connected classes that have no calculated metric yet.
10. A critical number set in Gyroscope but missing from the project or context description is a notice, with the recommendation to add it there.
11. Existing projects start from empty settings. Every value is prefilled as a recommendation that a person accepts.
12. Every question has a recommended option to accept.

Decisions taken in chat:

1. The plugin `settings` collection is the only source of truth. Descriptions are an input for recommendations only.
2. One Setup tab replaces Checkup and Metrics.
3. Code recommends wherever it can. The AI recommends the rest. AI answers are cached per project and recomputed only when the inputs change.
4. The industry setting is dropped. Nothing else used it.

## 1. Settings and their severity

Severity: 🔴 error, blocks the canvas · 🟡 warning, highly recommended · 🟢 notice.

"Code" means a pure function computes the recommendation. "AI" means the fast model picks it, with a code recommendation as the fallback. Every row always has a recommended option.

### 1.1 Goal

| # | Setting | Title | Question | Why | Severity | Recommended by |
|---|---|---|---|---|---|---|
| 1 | Critical number | Business Critical Number | What is the main business goal? | Every card is judged by how it moves this number. | 🔴 | AI. Fallback: code ranks numeric fields by name (revenue, profit, sales, orders) on the Data Marts with the most inbound references. |
| 2 | Date field | Critical Number Date | Which date does each value belong to? | To show the trend line and tell whether the number grows or declines. | 🔴 | Code: date fields of the critical number's Data Mart, ranked by name (date, created, order, event) and type (DATE before TIMESTAMP). |
| 3 | Aggregation and kind | How Values Add Up | Is it a total over the period, or a level on a day? | So a week or a quarter shows the right number. | 🟡 | Code: SUM and flow for amounts and counts; level for names with balance, stock, active, MRR or ARR. |
| 4 | Plan | Critical Number Plan | What should the number be? | To show whether the business is on track. | 🟡 | AI, from fields named plan, target, budget or forecast. Fallback: the same names ranked by code. |
| 5 | Plan shape | How the Plan Is Written | Is the plan a daily amount, a running total, or a level? | So the fact and the plan are compared for the same day. | 🟡, only when a plan is set | Code: cumulative when the plan values only grow within a month, level when the kind is level, else daily. |
| 6 | Goal in description | Goal in Project Description | Does the OWOX project description name the critical number? | So people and OWOX AI read the same goal. | 🟢 | Code. Recommended option: "Add this line to the description". Accept appends a one-row Metrics table. |

### 1.2 Core business entities

| # | Setting | Title | Question | Why | Severity | Recommended by |
|---|---|---|---|---|---|---|
| 7 | Core classes | Core Business Entities | Who buys, what is bought, and where do they come from? | These are drawn around the goal and show how the business fits together. | 🟡 | Code ranks candidates (`rankCore`): a single-column primary key, connected to the goal, referenced by two or more Data Marts, between 3 and 7 of them. The AI reorders the candidates by the project description. |

### 1.3 Teams

| # | Setting | Title | Question | Why | Severity | Recommended by |
|---|---|---|---|---|---|---|
| 8 | Contexts exist | Teams That Move the Goal | Which teams or areas own a part of the goal? | To group the canvas by team. | 🟢 | AI, from Data Mart names. Fallback: code groups Data Marts by keywords in their titles (Marketing: ads, campaign, session, traffic; Sales: order, deal, lead; Product: user, event). Recommended option: create the named contexts and add the listed Data Marts to each. The row is done once two contexts exist. |
| 9 | Team number, per context | {Team} Critical Number | Which number shows {Team} is doing its job? | To judge each team on its own number. | 🟡 | AI, from numeric fields of the context's Data Marts. Fallback: code ranks them like row 1. |
| 10 | Team plan, per context | {Team} Plan | What should {Team}'s number be? | To show whether the team is on track. | 🟢 | AI. Fallback: code, like row 4. |
| 11 | Team number in description, per context | {Team} Number in Context Description | Does the context description name its number? | So the team and OWOX AI read the same number. | 🟢 | Code. Recommended option: "Add this line to the description". |

### 1.4 Metrics, per class

| # | Setting | Title | Question | Why | Severity | Recommended by |
|---|---|---|---|---|---|---|
| 12 | Key metric | {Class} Headline Number | Which number should this class show first? | The card shows it large, with its trend. | 🟡 for the goal and core classes, 🟢 for others | Code: the class's metric linked to a plan, else the unique count, else the first SUM metric. |
| 13 | Shown metrics | {Class} Numbers on the Card | Which other numbers should the card show? | The card shows up to 3 small numbers under the headline. | 🟢 | Code: metrics with a plan first, then calculated fields, up to 3. |
| 14 | Metric plan, per shown metric | {Metric} Plan | What should {Metric} be? | To show whether it is on track. | 🟢 | AI. Fallback: code, like row 4. |
| 15 | Metric format | {Metric} Format | Is it a count, a share or money? | So it reads as 1,200, 4% or $1,200. | 🟢 | Code: percent for rate, share, ratio, CR, CTR; currency for revenue, cost, price, amount with the currency the field names; else number. |

### 1.5 Ratio metrics

| # | Setting | Title | Question | Why | Severity | Recommended by |
|---|---|---|---|---|---|---|
| 16 | Ratio, per pair of connected classes with no calculated metric between them | {A} per {B} | Should the canvas show {A} per {B}, for example Orders per Session? | It shows how well one step turns into the next. | 🟢 | Code finds the pairs: connected by an edge, both with a key metric, no calculated field of either referencing the other. The AI names each ratio and ranks them. Fallback: code names it "{A key} per {B key}". |

### 1.6 Data checks

Data checks aren't settings. They check the Data Marts that the settings point at. Each one still names a recommended fix.

| # | Check | Severity | Recommended fix |
|---|---|---|---|
| 17 | The goal Data Mart is published and you can access it | 🔴 | "Ask {owner} for access", opening the Data Mart page in OWOX |
| 18 | The goal Data Mart has a primary key | 🔴 | "Set `{field}` as the primary key", where code picks the field: name ends in `id`, unique by name, not nullable. Opens the schema page in OWOX. |
| 19 | A saved setting points at a field or Data Mart that no longer exists | 🔴 for rows 1 and 2, 🟡 for the rest | "Repick: `{old}` → `{closest}`" by name similarity. Accept saves the repick. |
| 20 | Each core class has a single-column primary key | 🟡 | Like row 18, opening that Data Mart in OWOX |
| 21 | Each core class connects to the goal | 🟡 | "Add a calculated field to {goal} that references {class}.{key}", opening the goal Data Mart in OWOX |
| 22 | You can access every Data Mart the settings use | 🟡 | "Ask {owner} for access" |

### 1.7 Housekeeping

| # | Setting | Title | Question | Why | Severity | Recommended by |
|---|---|---|---|---|---|---|
| 23 | AI credential | AI Assistant | Is an AI model connected to Gyroscope? | Without it, recommendations come from name rules only. | 🟡 | Code. Recommended option: "Map an AI credential", opening Plugins in OWOX. |
| 24 | Threshold | On-Track Margin | How far from plan still counts as near? | It decides when a card turns yellow or red. | 🟢 | Code: 20%. |

### 1.8 Row states

1. **Not set.** The row shows "Not set" with the recommended value as a chip and an Accept button.
2. **Set, same as the recommendation.** The row shows the value and ✓.
3. **Set, differs from the recommendation.** The row shows "{current}", then a ✨ chip "{recommended}" with Accept. The setting counts as done. A differing recommendation never reopens it.
4. **Broken.** A saved value points at something gone. It counts as open at its severity (row 19).
5. **Couldn't check.** A read failed. The row shows the reason and a retry, and counts as open at its severity.

A notice counts as done once accepted or dismissed. Dismissing is stored per setting (`dismissed: string[]`), so a project that has no plan data can clear its plan notices.

## 2. Storage

### 2.1 The settings document

`settings/project`, project scope, with `v: 5`. Only admins write it. It holds only values a person chose:

```ts
/** One number: a Data Mart field, how it adds up, and its date. */
interface MetricChoice { martId: string; measure: Measure; dateField: string | null; kind: MetricKind; alias: string }
interface RatioSetting { id: string; name: string; numerator: string; denominator: string; format: MetricFormat }
interface ProjectSettingsV5 {
  v: 5;
  goal: (MetricChoice & { plan: PlanDef | null }) | null;
  coreClasses: string[];                                   // Data Mart ids, at most 7
  contexts: Record<string, { metric: MetricChoice | null; plan: PlanDef | null }>;  // by context id
  classes: Record<string, { keyMetricId: string | null; shown: MetricChoice[] }>;    // by Data Mart id
  plans: Record<string, PlanDef>;                          // class metric plans, by metric id
  formats: Record<string, { format: MetricFormat; currency: string | null }>;      // by metric id
  ratios: RatioSetting[];
  thresholdPct: number;
  dismissed: string[];                                     // row ids of dismissed notices
  updatedAt: string | null; updatedBy: string | null;
}
```

1. `null`, an empty list or an absent key means "not set".
2. A save writes the whole document only when the stored `updatedAt` still equals the one loaded. Otherwise it throws `SettingsConflict(by, at)`, like `saveShared` today.
3. A 0.4 document (no `v`, or `v` below 5) reads as empty settings. Its `thresholdPct` is kept. `industry` and `coreClasses` are ignored, and the old core classes come back as recommendations instead (decision 11 above).

### 2.2 The derived model

`deriveModel(settings, inputs, schemas): Model | Blocked` is a pure function in `src/model/derive.ts`.

1. It returns today's `Model` shape, so `Canvas`, `Card`, `compute`, `query` and `refresh` keep working.
2. The goal, core classes, metrics, plans, keys and shown flags come from the settings.
3. Edges, depths, inbound counts and unique-count metrics come from the schemas, with the existing `buildEdges`, `classDepths`, `inboundCounts` and `uniqueCountMetric`.
4. With no goal or no date field it returns `Blocked` with `NO_GOAL` or `GOAL_NO_DATE`. The goal Data Mart's access and primary key keep their existing block codes.
5. It never calls the AI. The model isn't stored. It's derived on each load and cached in memory.
6. `cache` documents are keyed on a hash of the settings and the schemas, in place of `builtAt` and `editedAt`.

### 2.3 Recommendations

New project collection `suggestions`, doc `current`:

```ts
interface SuggestionsDoc { inputHash: string; at: string; items: Record<string, unknown> }  // by setting id
```

1. `inputHash` covers the descriptions, the Data Mart list and the schemas (the existing `inputHash`).
2. When an admin opens Setup and the hash differs, the AI recommenders run with the credential's `fast` tier, at most 4 at a time. Each answer is written into `items` as it arrives.
3. Code recommenders run on every open and are never stored.
4. A member without admin rights reads `suggestions` and never starts an AI call.
5. A failed or invalid AI answer leaves that item out. The row then shows its code recommendation.

### 2.4 Ratio metrics

`MetricDef` gains `ratio?: { numerator: string; denominator: string }`, both metric ids.

1. The ratio metric sits on the numerator's class. Its measure is unused.
2. Its value over a window is the numerator's value divided by the denominator's value over the same window. A zero or missing denominator gives `null`.
3. Its series is the daily quotient of the two series.
4. Its comparison and status work as for any metric. It has no plan unless one is set.

### 2.5 Manifest and release

1. `plugin.json` adds `{ "name": "suggestions", "scope": "project" }`.
2. `model`, `ontology` and `ontology_project` stay in the manifest, unread, so 0.4 installs keep their data.
3. Release 0.5.0, deployed at `/v5/`. `/v4/` stays as it is.
4. 🟡 Members still on 0.4 read `ontology_project` until OWOX updates the plugin, normally within a day. Changes made in 0.5 don't reach them before that.

## 3. The Setup tab

1. Settings has two tabs, General and Setup. Setup lives at `/settings/setup`. `/settings/checkup` and `/settings/ontology` redirect to it.
2. **Progress bar.** It sits on top, styled like the data quality checks.
   1. Its full width is every setting and data check on the page.
   2. Segments, left to right: done (grey), errors left (red), warnings left (yellow), notices left (green).
   3. Under it: "2 blockers · 5 recommended · 9 notices left". Each count scrolls to the first open row of that severity.
3. **Blocks**, in order: Goal, Core Business Entities, Teams, Metrics (one folded group per class, goal and core first), Ratio Metrics, Data Checks, Housekeeping.
   1. A block header has its title, its question, its why sentence, and the worst open severity as an icon.
   2. A block with no open rows starts folded.
4. **Rows.**
   1. On the left: the title, the question as the subtitle, and the why sentence in muted text.
   2. On the right: the current value or "Not set", the recommendation chip with Accept when it differs, and a dropdown with every option, the recommended one marked "Recommended".
   3. Choosing or accepting saves at once. There is no Save button and no draft.
   4. Each row has a status icon in the data-quality style: 🔴 🟡 🟢 ✓.
   5. Notices have a Dismiss action.
5. **Loading.** Code recommendations show at once. An AI recommendation not yet cached shows a spinner on its chip and is replaced when it arrives.
6. **Read-only.** Members without admin rights see the same page with values, recommendations and progress, and no Accept, Dismiss or dropdowns.
7. **Blocked canvas.** Until rows 1 and 2 are set, the canvas shows the blocked screen. Its button opens Setup at the Goal block.

## 4. Errors

1. A failed schema read marks only the rows that need that schema as "Couldn't check: {reason}", with a retry.
2. A failed AI call leaves that row on its code recommendation. Nothing is cached for it.
3. A save conflict reloads the settings and says "{who} changed setup at {time}". The choice isn't applied again on its own.
4. A description write (rows 6 and 11) reads the description right before writing and appends only. A failed write leaves the row open with the error.

## 5. Code

New:

1. `src/setup/types.ts`: `SettingId`, `Severity`, `Row`, `Option`, `Block`.
2. `src/setup/catalog.ts`: titles, questions, why sentences and severities for every row in section 1.
3. `src/setup/recommend/*.ts`: one pure code recommender per row; `ai.ts` for the AI recommenders.
4. `src/setup/rows.ts`: builds every row's state from the settings, the inputs, the schemas and the recommendations.
5. `src/setup/progress.ts`: counts open rows by severity.
6. `src/model/derive.ts`: `deriveModel`.
7. `src/store/settings.ts`: load and save `ProjectSettingsV5`, `SettingsConflict`, load and save `SuggestionsDoc`.
8. `src/ui/SetupTab.tsx`, `src/ui/SetupRow.tsx`, `src/ui/ProgressBar.tsx`.

Removed:

1. `src/model/interpret.ts`, the AI step of `src/model/build.ts`, `src/ui/RebuildProposal.tsx`, `src/ui/BuildProgress.tsx`.
2. `src/checkup/*` and `src/ui/CheckupTab.tsx`. Checks worth keeping move into `src/setup/` as data checks.
3. `src/ui/OntologyTab.tsx`. Its field pickers (`FieldPicker`, `SourcePicker`) are reused by the rows.
4. `INDUSTRIES` and `Industry`.

Changed:

1. `src/App.tsx`: load settings and derive the model in place of loading or building the shared model; routes.
2. `src/ui/SettingsPage.tsx`: two tabs.
3. `src/types.ts`: `MetricDef.ratio`, `BlockCode` gains `GOAL_NO_DATE`, `ProjectSettings` becomes `ProjectSettingsV5`.
4. `src/metrics/compute.ts`: ratio metrics.
5. `src/store/collections.ts`: cache key and `isStale` use the settings hash.

## 6. Testing

1. `deriveModel`: the same settings and schemas give an equal model. Fixtures cover a new project (blocked), a filled project, and a broken reference.
2. Code recommenders: table tests per row, such as date field ranking, aggregation and kind, core ranking with the 3 to 7 bounds, ratio pairs, and format.
3. AI recommenders: a fake `generateWith`. A bad or failed answer gives no AI item, and the row falls back to code.
4. Every row has a recommended option in every state: one test walks the catalog over the fixtures.
5. `progress`: counts by severity, with dismissed notices and broken rows.
6. Settings store: conflict on a changed `updatedAt`, a 0.4 document reads as empty with its threshold kept.
7. Ratio compute: value, zero denominator, and series.
8. `SetupTab`: rendering each row state (not set, set, differs, broken, couldn't check, read-only), Accept saving, and Dismiss.
9. The manifest test expects `suggestions` and version `0.5.x`.

## Out of scope

1. Writing to the warehouse or to Data Mart schemas. Fixes that need OWOX open the right OWOX page.
2. Editing a ratio's formula beyond numerator and denominator.
3. A first-run wizard.
