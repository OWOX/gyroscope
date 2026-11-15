# Gyroscope

Gyroscope is an OWOX Data Marts plugin that answers one question first: are we on track for the goal in the project description? It draws the project's ontology: one model of business classes, the same for every member of the project.

1. With no date range, the default, the canvas is the ontology view. The class that owns the goal sits in the center, with 3 to 7 core dictionary classes (Customers, Users, Products) around it. Cards show class names only.
2. With a date range, the canvas is the flow view. Each card shows one key metric against plan, with a trend, and with a forecast when the range ends in the future. Classes connected to the core ones appear below them.

The [shared ontology spec](docs/superpowers/specs/2026-11-11-shared-ontology-design.md) describes both views.

## Requirements in OWOX

1. A Data Mart field that holds the project goal. An admin picks it in Setup (Business Critical Number). Setup also offers to add a Critical number row linking to it in the project description.
2. An AI Credential is optional. When one is mapped at install, Gyroscope uses it to recommend answers in Setup. It never saves one for you.
3. Calculated fields in your Data Marts reference other Data Marts. Gyroscope draws a connection for each reference.
4. An admin sets the goal in Setup once. Until then, a member sees the "Goal can't be tracked" screen: the Business Critical Number is not set, and they are told to ask a project admin to finish Setup.

Settings has two tabs. General holds your own view settings. Setup replaces Checkup and Metrics: one list of questions in blocks (goal, core classes, contexts, metrics with their plans and formats, ratios, data checks, housekeeping, which holds the On-Track Margin threshold). Each question has a (?) hint and a radio list of answers, with the recommended one first and tagged. An admin picks an option, and Gyroscope stores exactly that. Choices are staged and written together by Save. Discard drops them. Optional notices have a "Not needed" answer. Members see the values read-only. The AI only recommends one of the options the code built.

## Release notes

### 0.5.0

1. Setup replaces Checkup and Metrics. Settings are stored as chosen, not computed.
2. The AI only recommends. Every question has a recommended option with or without an AI credential, and the AI can only pick from the options Gyroscope built.
3. Existing projects start from empty settings with recommendations for every question. The 0.4 threshold is kept, and the old core classes come back as recommendations.
4. Ratio metrics: divide one metric by another.
5. A member who can't access the project goal Data Mart sees the canvas centered on the nearest context critical number they can access, or is told to ask for access.
6. Removed: the AI model build, rebuild proposals and the industry setting.
7. Setup choices are radio lists with a (?) hint on each question and block. They are staged and written together by Save. Optional notices can be marked "Not needed".

## Develop

```bash
npm install
npm test
npm run typecheck
npm run build
```

The plugin platform does not support a local preview. Test Gyroscope as an installed plugin.

## Release

1. Push to `main`. GitHub Pages deploys `dist/` to the folder of the compatibility line: `v5/` for 0.5.x. Installs of 0.2 keep loading the root.
2. A new compatibility line (0.6) needs `plugin.json` `delivery.url` moved to its folder (`/v6/`); a test fails until it is.
3. Check the plugin with `owox-ctl plugins check OWOX/gyroscope --ref main`.
4. Create a release with `gh release create v0.5.0 --target <full commit SHA> --generate-notes`.
5. In OWOX, open Plugins, then Publish Plugin, and choose "Only me" for testing.

## How it works

The [design spec](docs/superpowers/specs/2026-10-24-gyroscope-design.md) has the details. Each step below maps to a section.

1. Derive the ontology model: Gyroscope turns the saved Setup answers, Data Marts, references and contexts into classes, connections and metrics (spec section 5).
2. Date ranges: presets, the fact window, the forecast window and the comparison window, all in UTC (section 6).
3. Metrics: one query per metric, a forecast, plan values and statuses (section 7).
4. Canvas and card: layout by reference distance, context filters, and the metric card (section 8).
5. States: blocked, failed and loading screens, each with a fix or a retry (section 9).
6. Cache: the canvas reads cached results, and a refresh runs when the data is stale (section 10).

The [Setup spec](docs/superpowers/specs/2026-11-14-setup-tab-design.md) covers the Setup tab. The [shared ontology spec](docs/superpowers/specs/2026-11-11-shared-ontology-design.md) covers the shared model, core classes, the two views.
