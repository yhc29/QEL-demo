# QEL / BEST docs

Standalone browser documentation and demos for the QEL/PGES temporal query engine. Everything in this folder is static HTML, CSS, and JavaScript. The pages use synthetic records only, run entirely in the browser.

## Quick start

From the repository root:

```bash
python3 -m http.server 8123 --directory ./
```

Open:

- <http://localhost:8123/qel-reproducibility.html> — narrative guide
- <http://localhost:8123/qel-playground.html> — interactive cohort playground
- <http://localhost:8123/qel-algorithm.html> — Algorithms 1–3 walkthrough

`file://` works for basic viewing, but browsers block the playground's dataset fetch there; serve the folder over HTTP or use **Choose JSON** to load `pges-manual-eval.json` manually. There is no build step, package install, CDN dependency, or backend requirement.

## Files

| File | Purpose |
| --- | --- |
| `qel-reproducibility.html` | Self-contained guide to interval ensembles, endpoint arithmetic, PGES formulas, strict semantics, and backend mappings. |
| `qel-playground.html` | Interactive cohort builder for the 54-case evaluation set, with GTC/PGES presets, a suppression filter, two solver paths, JSON replacement, and pattern/patient counts. |
| `qel-algorithm.html` | Interactive trace of Algorithms 1–3 on record P01: primitives, model checking, and finite-evidence scanning. |
| `qel-query-core.js` | Shared JavaScript engine. Exposes `window.QELCore` and is loaded by the playground and algorithm page. |
| `pges-manual-eval.json` | 54-case manual evaluation set, version 3.0.0, with expected base and strict outcomes. |

## What each page covers

### Reproducibility guide

`qel-reproducibility.html` explains the data model and formulas without requiring the backend:

- BEST labels: `S` seizure, `T` tonic, `C` clonic, `P` EEG suppression.
- Canonical interval ensembles with open and closed endpoints.
- Displacement, dilation, erosion, complement, intersection, and union.
- The permissive base PGES formula and the exact strict PGES formula.
- Worked P01 witness and timeline.
- Mapping of interval primitives to backend functions in `eeg_query_api.rs`.
- Current 54-case evaluation counts (base 47 patterns/43 patients, strict 36/33) and inspection workflow.

### Playground

`qel-playground.html` is the interactive cohort query page:

- Loads the 54-case evaluation set (`pges-manual-eval.json`) by default over HTTP; **Choose JSON** replaces it, and **Reload 54 cases** restores the default set.
- 54 synthetic BEST records over 0–240 s.
- Presets: GTC, PGES base, PGES strict. **Custom formula** copies the selected preset into a query builder where each temporal operator, time term, and event label can be changed; the formula string can also be edited directly. The QEL notation and raw formula string are shown together and stay in sync.
- `c >= n` witness filter for suppression duration.
- Solver selector:
  - **Optimized witness search** — observed interval-boundary candidates verified with interval support.
  - **Paper boundary scan (Algorithm 3)** — the same observed boundaries enumerated as ordered points, also verified with interval support.
- Audit panel with the selected witness, per-conjunct checks, and matched pattern details.
- Custom formula results call `QELCore.queryFormula` for every case and show the first witness per matched case. The builder reports query errors inline and allows half-open event boundaries.
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

The parser accepts any event label in the case, plus `noevent` for the complement of all case events; `diamond(duration, formula)` (also `dia`), `box(duration, formula)`, `box_neg(duration, formula)`, `diamond_neg(duration, formula)`, `shift(offset, formula)`, `neg(formula)` (also `not`), `and(left, right)`, and `or(left, right)`. `box_neg(t, P)` means `box(t, neg(P))`; `diamond_neg(t, P)` means `diamond(t, neg(P))`. Time terms support numbers, named variables, addition, subtraction, and parentheses. `queryFormula(formulaString, caseData)` derives positive duration candidates from every interval endpoint and every positive difference between endpoints. Variables used only by `shift` may also take zero or negative endpoint differences. It returns the first satisfying assignment and its reference point `x`. Pass `{ halfOpen: true }` as the third argument for strict boundary semantics. For a case with many endpoints, `{ maxEvaluations: n }` sets the search limit; reaching it throws an error instead of reporting a false nonmatch. The playground's Custom formula mode calls this API for each case.

The PGES body is:

```text
□_{a+b}S ∧ ◊_aT ∧ (◊_bC)_a ∧ (□_cP)_{a+b}
```

The strict body adds a 10 s no-event prefix and the exclusions `S∧¬P`, `T∧¬C`, `C∧¬T`, and `P∧¬S`. Strict supports are evaluated as half-open intervals, so adjacent boundaries meet rather than overlap.

A candidate is accepted when the formula support contains the reference point `x`.

## Solver paths

`QELCore` exports two search paths:

| Function | Role |
| --- | --- |
| `findMatches(record, query)` | Optimized boundary-candidate search used by default. |
| `findMatchesFiniteCell(record, query)` | Paper boundary scan using `finiteCellPoints` candidates. |
| `boundaryPoints(record, labels)` | Returns the sorted, unique interval endpoints already present in the record. |
| `finiteCellPoints(record, labels)` | Backward-compatible alias for `boundaryPoints` in Algorithm 3. |

Both paths use the same `support` verifier and draw their candidate `x`/`a`/`b`/`c` values only from observed interval boundaries. They do not use midpoint candidates, epsilon-shifted candidates, or random sampling. In the strict formula, `x` is derived as the S start minus the fixed 10 s quiet prefix; the S/T/C/P window boundaries still come from the record.

Numeric comparisons use `EPS = 1e-6` and `TOL = 1e-9`. They are not exact rational arithmetic, so filtering very close to a boundary can differ by a tolerance-scale amount.

## Manual evaluation set

`pges-manual-eval.json` contains one dataset evaluated by two formulas:

- `queries.base`: permissive PGES reference query.
- `queries.strict`: exact strict PGES formula with a 10 s quiet prefix and in-formula exclusions.
- `cases[]`: 54 cases, each with `events`, `expected`, and `expected_strict`.
- `strict_quiet_seconds`: `10`.

At `c >= 0`, both formulas should agree with every expected case. The playground starts with 47 base patterns among 43 patients, 36 strict patterns among 33 patients, and 11 base-only patterns; 10 cases have no strict match. It reports patient and pattern counts separately. The set is synthetic and is not the paper's clinical cohort.

### JSON dataset format

Use a JSON object with a required top-level `cases` array. Each case needs a unique `id` and an `events` object. Event labels may be any identifier that starts with a letter or underscore and continues with letters, digits, or underscores; `noevent` is reserved. Each event maps to an array of closed `[start, end]` intervals in seconds; an empty array means that event is absent. Endpoints must be finite numbers and `start` must not exceed `end`.

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

