# QEL / BEST docs

Standalone browser documentation and demos for the QEL/PGES temporal query engine. Everything in this folder is static HTML, CSS, and JavaScript. The included example records are synthetic; the playground can load other labeled temporal datasets in the supported JSON format.

## GitHub Pages

The repository is a plain static site published from the repository root, so GitHub Pages serves it as-is:

- <https://yhc29.github.io/QEL-demo/> — narrative guide (`index.html`)
- <https://yhc29.github.io/QEL-demo/qel-playground.html> — interactive cohort playground
- <https://yhc29.github.io/QEL-demo/qel-algorithm.html> — Algorithms 1–3 walkthrough

Enable it under **Settings → Pages → Build and deployment → Deploy from a branch**, then choose branch `main` and folder `/ (root)`. The `.nojekyll` file at the root disables Jekyll processing so every static asset is published unchanged. All links are relative, so the site works both at a project path (`/QEL-demo/`) and at a user root.

## Local preview

From the repository root:

```bash
python3 -m http.server 8123 --directory ./
```

Open:

- <http://localhost:8123/index.html> — narrative guide
- <http://localhost:8123/qel-playground.html> — interactive cohort playground
- <http://localhost:8123/qel-algorithm.html> — Algorithms 1–3 walkthrough

`file://` works for basic viewing, but browsers block the playground's dataset fetch there; serve the folder over HTTP or use **Choose JSON** to load `pges-manual-eval.json` manually. There is no build step, package install, CDN dependency, or backend requirement.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Landing page and self-contained guide to interval ensembles, endpoint arithmetic, PGES formulas, and strict semantics. |
| `qel-playground.html` | Interactive cohort builder for the 54-case evaluation set, with GTC/PGES presets, a suppression filter, two solver paths, JSON replacement, and pattern/patient counts. |
| `qel-algorithm.html` | Interactive trace of Algorithms 1–3 on record P01: primitives, model checking, and finite-evidence scanning. |
| `qel-query-core.js` | Shared JavaScript engine. Exposes `window.QELCore` and is loaded by the playground and algorithm page. |
| `pges-manual-eval.json` | 54-case manual evaluation set, version 3.0.0, with expected base and strict outcomes. |
| `.nojekyll` | Tells GitHub Pages to publish the folder without Jekyll processing. |

## What each page covers

### Reproducibility guide

`index.html` explains the data model and formulas without requiring the backend:

- BEST labels: `S` seizure, `T` tonic, `C` clonic, `P` EEG suppression.
- Canonical interval ensembles with open and closed endpoints.
- Displacement, dilation, erosion, complement, intersection, and union.
- The permissive base PGES formula and the exact strict PGES formula.
- Worked P01 witness and timeline.
- Current 54-case evaluation counts (base 47 patterns/43 patients, strict 36/33) and inspection workflow.

### Playground

`qel-playground.html` is the interactive cohort query page:

- Loads the 54-case evaluation set (`pges-manual-eval.json`) by default over HTTP; **Choose JSON** replaces it, and **Reload 54 cases** restores the default set.
- 54 synthetic BEST records over 0–240 s.
- Presets: GTC, PGES base, PGES strict. **Custom formula** copies the selected preset into a query builder where each temporal operator, time term, and event label can be changed; the formula string can also be edited directly. The QEL notation and raw formula string are shown together and stay in sync.
- `c >= n` witness filter for suppression duration.
- Solver selector:
  - **Complete base PGES** (default) — exact constraint search at observed anchors; strict and GTC fall back to the optimized search.
  - **Optimized witness search** and **Boundary scan** — endpoint-based heuristics; both can miss matches.
- Audit panel with the selected witness, per-conjunct checks, and matched pattern details.
- Custom formula results call `QELCore.queryFormula` for every case and show the first witness per matched case. The builder reports query errors inline with half-open event boundaries.
- Results table that reports matched patterns and patients separately for base, strict, and base-only queries.

### Algorithms 1–3

`qel-algorithm.html` runs the three paper algorithms on record P01:

- **Algorithm 1**: apply one interval-ensemble primitive and inspect the normalized result.
- **Algorithm 2**: translate a candidate, substitute `q = x`, eliminate auxiliary variables, and evaluate every conjunct.
- **Algorithm 3**: enumerate observed boundary quadruples and verify the full PGES body support.

All three pages share the same cool-gray visual system.

## Core semantics

`qel-query-core.js` implements a canonical interval-ensemble algebra:

```text
atom        -> stored support
and         -> intersection
or          -> union
not         -> complement
box(t)      -> erosion by t
diamond(t)  -> dilation by t
shift(u)    -> displacement by u
```

Every operation returns a normalized ensemble. Normalization removes empty intervals and merges overlapping or adjacent compatible intervals.

Custom formulas can be parsed and queried for one case without adding a new hard-coded AST:

```js
const formula = "and(box(a+b,S), shift(a, diamond(b, C)))";
const caseData = evaluationSet.cases[0]; // { id, events: { S: [[10,70]], ... } }
const result = QELCore.queryFormula(formula, caseData);
// { matched: true, witness: { x, variables: { a, b }, support }, ... }

const ast = QELCore.parseFormulaString(formula);
const raw = QELCore.formulaToString(ast); // functional query syntax
const display = QELCore.formatFormula(ast); // { string, html } for QEL notation
const support = QELCore.evaluateFormulaString(preparedRecord, ast, { a: 10, b: 5 });
```

The parser accepts any event label in the case, plus `noevent` for the complement of all case events; `diamond(duration, formula)` (also `dia`), `box(duration, formula)`, `box_neg(duration, formula)`, `diamond_neg(duration, formula)`, `shift(offset, formula)`, `neg(formula)` (also `not`), `and(left, right)`, and `or(left, right)`. `box_neg(t, P)` means `box(t, neg(P))`; `diamond_neg(t, P)` means `diamond(t, neg(P))`. Time terms support numbers, named variables, addition, subtraction, and parentheses. `queryFormula(formulaString, caseData)` derives positive duration candidates from every interval endpoint and every positive difference between endpoints. Variables used only by `shift` may also take zero or negative endpoint differences. It returns the first satisfying assignment and its reference point `x`. Input intervals use left-closed, right-open semantics. For a case with many endpoints, `{ maxEvaluations: n }` sets the search limit; reaching it throws an error instead of reporting a false nonmatch. The playground's Custom formula mode calls this API for each case.

The PGES body is:

```text
□_{a+b}S ∧ ◊_aT ∧ (◊_bC)_a ∧ (□_cP)_{a+b}
```

The strict body adds a 10 s no-event prefix and the exclusions `S∧¬P`, `T∧¬C`, `C∧¬T`, and `P∧¬S`. All input supports are evaluated as half-open intervals, so adjacent boundaries meet rather than overlap.

A candidate is accepted when the formula support contains the reference point `x`.

## Solver paths

`findMatchesComplete(record, query)` is complete for the base PGES formula over finite, left-closed, right-open input intervals, when the reference point `x` is restricted to observed S/T/C/P endpoints. It enumerates those anchors and interval components, then solves the ordering and coverage inequalities using exact rational arithmetic. It does not restrict the split or seizure offset to observed endpoints. The suppression filter is included in those inequalities. JavaScript input numbers are interpreted as the decimal values in their `String(number)` representation; precision already lost during JSON parsing cannot be recovered. The returned `exactWitness` records rational numerator/denominator pairs. Displayed witnesses and support audits use floating-point arithmetic and may be inaccurate for extremely close endpoints.

The proof follows from writing `y=x+a` and `z=x+a+b`: for each anchor and relevant S, T, C, and P component, the existence of a witness is equivalent to the interval inequalities checked by the solver. It chooses an interior rational when a strict inequality requires one. It reports at most one witness per S component, not every possible witness. It does not claim completeness for arbitrary real-valued anchors, open input intervals, GTC, strict PGES, or custom formulas. Intervals passed directly to this path must be finite and left-closed, right-open. GTC and strict queries use the existing optimized path.

`findMatches` and `findMatchesFiniteCell` are retained as endpoint heuristics. They are incomplete: ME14 has S=T=C=[0,2] and P=[2,3], and both miss the valid witness (0,1,1,1). `finiteCellPoints` is an endpoint alias, not an implementation of the paper's complete cell construction. These older paths and the general support evaluator use `EPS = 1e-6` and `TOL = 1e-9`, so near-boundary results may differ from exact semantics. The algorithm demonstration's boundary scan is illustrative and is not a complete implementation of the paper's construction.

Run the regression checks with `node tests/complete-pges.js`.

## Manual evaluation set

`pges-manual-eval.json` contains one dataset evaluated by two formulas:

- `queries.base`: permissive PGES reference query.
- `queries.strict`: exact strict PGES formula with a 10 s quiet prefix and in-formula exclusions.
- `cases[]`: 54 cases, each with `events`, `expected`, and `expected_strict`.
- `strict_quiet_seconds`: `10`.

At `c >= 0`, the complete base solver and the existing strict solver agree with every expected case. The endpoint heuristics miss ME14. The playground starts with 47 base patterns among 43 patients, 36 strict patterns among 33 patients, and 11 base-only patterns; 10 cases have no strict match. It reports patient and pattern counts separately. The set is synthetic and is not the paper's clinical cohort.

### Clinical data and alternatives

The clinical data used in the paper's experiments are from [SUDEP Research](https://sudepresearch.org/) and are not publicly available. This repository does not contain those data; its included 54-case evaluation set is synthetic and is provided to demonstrate the queries.

You can use other labeled temporal data in place of the example set. Convert each case's annotations into event-labeled time intervals in the supported [JSON dataset format](#json-dataset-format), then load the file in the playground with **Choose JSON**. The labels and event intervals should reflect the events and time units used by your query.

### JSON dataset format

Use a JSON object with a required top-level `cases` array. Each case needs a unique `id` and an `events` object. Event labels may be any identifier that starts with a letter or underscore and continues with letters, digits, or underscores; `noevent` is reserved. Each event maps to an array of left-closed, right-open `[start, end)` intervals in seconds; an empty array means that event is absent. Endpoints must be finite numbers and `start` must not exceed `end`.

```json
{
  "name": "my-evaluation",
  "version": "1.0.0",
  "description": "Small reproducible example",
  "labels": ["S", "T", "C", "P"],
  "axis_seconds": [0, 120],
  "cases": [
    {
      "id": "CASE-01",
      "title": "Example case",
      "category": "valid",
      "events": {
        "S": [[10, 50]],
        "T": [[10, 22]],
        "C": [[26, 48]],
        "P": [[50, 80]]
      },
      "expected": {
        "shouldMatch": true,
        "minPatterns": 1,
        "reason": "Optional explanation for the base PGES preset"
      },
      "expected_strict": {
        "shouldMatch": true,
        "reason": "Optional explanation for the strict PGES preset"
      },
      "note": "Optional case annotation",
      "relation_focus": { "S-P": "P starts at the end of S" }
    }
  ]
}
```

`name`, `version`, `description`, `labels`, and `axis_seconds` are dataset metadata. `labels` documents the event vocabulary; labels used in formulas and query builder controls come from the `events` objects. The upper value in `axis_seconds` sets the timeline's suggested extent; the chart expands to include larger event endpoints and has a 240 s minimum extent. For each case, `title`, `category`, `note`, and `relation_focus` are optional display text. `expected` and `expected_strict` are optional manual outcomes with `shouldMatch`, optional `minPatterns`, and an optional `reason`; they support the preset agreement summary and audit panel and do not change query evaluation. A `formula` field may also be included as descriptive metadata.

To reproduce a query, keep the JSON file with the project, record the formula or preset and interval-boundary setting, then load it with **Choose JSON** → **Load selected**. **Download dataset** exports the current cases in this same `cases[]` format so the file can be loaded again.
