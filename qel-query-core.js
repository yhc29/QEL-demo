(function (root) {
  "use strict";

  const EPS = 1e-6;
  const TOL = 1e-9;
  const STRICT_QUIET = 10;

  /* ---------- interval ensembles ---------- */
  function iv(a, b, lc = true, rc = true) { return { a, b, lc, rc }; }
  function isEmpty(x) {
    return x.a > x.b + TOL || (Math.abs(x.a - x.b) <= TOL && !(x.lc && x.rc));
  }
  function norm(list) {
    const xs = list.filter(x => !isEmpty(x)).map(x => ({ ...x }));
    xs.sort((u, v) => u.a - v.a || (u.lc ? 0 : 1) - (v.lc ? 0 : 1));
    const out = [];
    for (const cur of xs) {
      if (!out.length) { out.push(cur); continue; }
      const last = out[out.length - 1];
      let merge = false;
      if (cur.a < last.b - TOL) merge = true;
      else if (Math.abs(cur.a - last.b) <= TOL) merge = last.rc || cur.lc;
      if (merge) {
        if (cur.b > last.b + TOL) { last.b = cur.b; last.rc = cur.rc; }
        else if (Math.abs(cur.b - last.b) <= TOL) { last.rc = last.rc || cur.rc; }
      } else {
        out.push(cur);
      }
    }
    return out;
  }
  function contains(IE, x) {
    return IE.some(i =>
      (i.lc ? x >= i.a - TOL : x > i.a + TOL) &&
      (i.rc ? x <= i.b + TOL : x < i.b - TOL)
    );
  }
  function displace(IE, q) {
    return norm(IE.map(i => ({ ...i, a: i.a - q, b: i.b - q })));
  }
  function dilate(IE, r) {
    return norm(IE.map(i => ({ ...i, a: i.a - r, lc: false })));
  }
  function erode(IE, r) {
    return norm(IE.map(i => ({ ...i, b: i.b - r, rc: true })));
  }
  function intersect(A, B) {
    const out = [];
    for (const a of A) for (const b of B) {
      const start = Math.max(a.a, b.a);
      const end = Math.min(a.b, b.b);
      const lc = a.a > b.a + TOL ? a.lc : (b.a > a.a + TOL ? b.lc : a.lc && b.lc);
      const rc = a.b < b.b - TOL ? a.rc : (b.b < a.b - TOL ? b.rc : a.rc && b.rc);
      const c = iv(start, end, lc, rc);
      if (!isEmpty(c)) out.push(c);
    }
    return norm(out);
  }
  function union(A, B) { return norm([...A, ...B]); }
  function complement(IE) {
    const s = norm(IE);
    if (!s.length) return [iv(-Infinity, Infinity, false, false)];
    const out = [iv(-Infinity, s[0].a, false, !s[0].lc)];
    for (let i = 0; i < s.length - 1; i++) {
      out.push(iv(s[i].b, s[i + 1].a, !s[i].rc, !s[i + 1].lc));
    }
    out.push(iv(s[s.length - 1].b, Infinity, !s[s.length - 1].rc, false));
    return norm(out);
  }
  function intervalAt(IE, p) {
    if (p == null) return null;
    return IE.find(i =>
      (i.lc ? p >= i.a - TOL : p > i.a + TOL) &&
      (i.rc ? p <= i.b + TOL : p < i.b - TOL)
    ) || null;
  }
  function nextPoint(IE, x) {
    const s = norm(IE);
    for (const i of s) {
      if (i.b < x - TOL) continue;
      if (Math.abs(i.b - x) <= TOL && !i.rc) continue;
      if (x < i.a - TOL) return i.a;
      if (x <= i.b + TOL) return Math.max(x, i.a);
    }
    return null;
  }
  function componentEnd(IE, x) {
    for (const i of IE) {
      const inLeft = i.lc ? x >= i.a - TOL : x > i.a + TOL;
      const inRight = i.rc ? x <= i.b + TOL : x < i.b - TOL;
      if (inLeft && inRight && x < i.b - TOL) return i.b;
    }
    return null;
  }
  function pRoom(P, y) {
    for (const i of P) {
      const inLeft = i.lc ? y >= i.a - TOL : y > i.a + TOL;
      const inRight = i.rc ? y <= i.b + TOL : y < i.b - TOL;
      if (inLeft && inRight) {
        const room = i.b - y;
        return room > EPS ? room : null;
      }
    }
    return null;
  }

  /* ---------- QEL expression AST ---------- */
  const V = name => ({ type: "var", name });
  const add = (left, right) => ({ type: "add", left, right });
  const sub = (left, right) => ({ type: "sub", left, right });
  const A = label => ({ type: "atom", label });
  const box = (t, child) => ({ type: "box", t, child });
  const dia = (t, child) => ({ type: "diamond", t, child });
  const boxNeg = (t, child) => ({ type: "box_neg", t, child });
  const diaNeg = (t, child) => ({ type: "diamond_neg", t, child });
  const shift = (u, child) => ({ type: "shift", u, child });
  const and = (left, right) => ({ type: "and", left, right });
  const or = (left, right) => ({ type: "or", left, right });
  const not = child => ({ type: "not", child });
  const NOEVENT = { type: "noevent" };

  /* Parse the small, data-only QEL surface syntax used by custom queries.
     Example: shift(a, diamond(b, and(T, neg(C)))) */
  function parseFormulaString(source) {
    if (typeof source !== "string" || !source.trim()) throw new Error("Formula must be a non-empty string");
    const tokens = source.match(/[A-Za-z_][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)|[()+,\-]/g) || [];
    const compact = source.replace(/\s+/g, "");
    if (tokens.join("") !== compact) throw new Error("Formula contains unsupported characters");
    let index = 0;
    const peek = () => tokens[index];
    const take = expected => {
      const token = tokens[index++];
      if (expected && token !== expected) throw new Error(`Expected '${expected}' in formula`);
      return token;
    };
    function factor() {
      if (peek() === "-") { take("-"); return sub(0, factor()); }
      if (peek() === "(") { take("("); const value = term(); take(")"); return value; }
      const token = take();
      if (token == null || !/^(?:[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
        throw new Error("Expected a time term");
      }
      return /^\d/.test(token) || token[0] === "." ? Number(token) : V(token);
    }
    function term() {
      let node = factor();
      while (peek() === "+" || peek() === "-") {
        const operation = take();
        node = operation === "+" ? add(node, factor()) : sub(node, factor());
      }
      return node;
    }
    function expr() {
      const name = take();
      if (peek() !== "(") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid event atom '${name}'`);
        if (name === "noevent") return NOEVENT;
        return A(name);
      }
      take("(");
      if (name === "neg" || name === "not") { const child = expr(); take(")"); return not(child); }
      if (name === "and" || name === "or") {
        const left = expr(); take(","); const right = expr(); take(")");
        return name === "and" ? and(left, right) : or(left, right);
      }
      if (["box", "diamond", "dia", "box_neg", "diamond_neg"].includes(name)) {
        const duration = term(); take(","); const child = expr(); take(")");
        if (name === "box") return box(duration, child);
        if (name === "box_neg") return boxNeg(duration, child);
        if (name === "diamond_neg") return diaNeg(duration, child);
        return dia(duration, child);
      }
      if (name === "shift") {
        const amount = term(); take(","); const child = expr(); take(")");
        return shift(amount, child);
      }
      throw new Error(`Unknown formula operator '${name}'`);
    }
    const ast = expr();
    if (index !== tokens.length) throw new Error(`Unexpected token '${peek()}'`);
    return ast;
  }

  function formulaToString(input) {
    const node = typeof input === "string" ? parseFormulaString(input) : input;
    function term(value) {
      if (typeof value === "number") return String(value);
      if (value.type === "var") return value.name;
      const sign = value.type === "sub" ? "-" : "+";
      return `(${term(value.left)}${sign}${term(value.right)})`;
    }
    function expr(value) {
      if (value.type === "atom") return value.label;
      if (value.type === "noevent") return "noevent";
      if (value.type === "not") return `neg(${expr(value.child)})`;
      if (value.type === "and" || value.type === "or") {
        return `${value.type}(${expr(value.left)},${expr(value.right)})`;
      }
      if (["box", "diamond", "box_neg", "diamond_neg", "shift"].includes(value.type)) {
        return `${value.type}(${term(value.t ?? value.u)},${expr(value.child)})`;
      }
      throw new Error(`Unknown formula node '${value.type}'`);
    }
    return expr(node);
  }

  // A single AST produces both the functional query string and display markup.
  function formatFormula(input) {
    const ast = typeof input === "string" ? parseFormulaString(input) : input;
    const escape = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    function term(value, parent = null, rightSide = false) {
      if (typeof value === "number") return escape(value);
      if (value.type === "var") return escape(value.name);
      const sign = value.type === "sub" ? "−" : "+";
      const content = value.type === "sub" && value.left === 0
        ? `−${term(value.right, value.type, true)}`
        : `${term(value.left, value.type, false)}${sign}${term(value.right, value.type, true)}`;
      return parent === "sub" && rightSide ? `(${content})` : content;
    }
    const parens = content => `<span class="paren">(</span>${content}<span class="paren">)</span>`;
    function expr(value, parent = null) {
      let content;
      if (value.type === "atom") {
        const eventClass = /^[STCP]$/.test(value.label) ? ` ${value.label.toLowerCase()}` : "";
        content = `<span class="ev${eventClass}">${escape(value.label)}</span>`;
      } else if (value.type === "noevent") {
        content = '<span class="ev empty">∅</span>';
      } else if (value.type === "not") {
        content = `<span class="op">¬</span>${expr(value.child, "unary")}`;
      } else if (["box", "diamond", "box_neg", "diamond_neg"].includes(value.type)) {
        const symbol = value.type.startsWith("box") ? "□" : "◊";
        const negation = value.type.endsWith("_neg") ? '<span class="op">¬</span>' : "";
        content = `<span class="op">${symbol}</span><sub>${term(value.t)}</sub>${negation}${expr(value.child, "unary")}`;
      } else if (value.type === "shift") {
        content = `${parens(expr(value.child))}<sub>${term(value.u)}</sub>`;
      } else if (value.type === "and" || value.type === "or") {
        const symbol = value.type === "and" ? "∧" : "∨";
        content = `${expr(value.left, value.type)} <span class="op">${symbol}</span> ${expr(value.right, value.type)}`;
      } else {
        throw new Error(`Unknown formula node '${value.type}'`);
      }
      return (value.type === "and" || value.type === "or") && parent && parent !== value.type
        ? parens(content) : content;
    }
    const variables = [...formulaVariables(ast)].filter(name => name !== "x");
    const quantifiers = ["x", ...variables].map(name => `∃${escape(name)}`).join(" ");
    return {
      string: formulaToString(ast),
      html: `<span class="q">${quantifiers}</span> <span class="br">[</span> ${expr(ast)} <span class="br">]</span><sub class="q">x</sub>`
    };
  }

  function evaluateFormulaString(record, formulaString, env = {}) {
    const expression = typeof formulaString === "string" ? parseFormulaString(formulaString) : formulaString;
    return support(expression, env, record);
  }

  // Retained for callers that already provide concrete time values.
  function findFormulaMatches(record, formulaString, env = {}, labels = ["S", "T", "C", "P"]) {
    const formulaSupport = evaluateFormulaString(record, formulaString, env);
    return boundaryPoints(record, labels).filter(x => contains(formulaSupport, x))
      .map(x => ({ patientId: record.id, x, support: formulaSupport, env: { ...env } }));
  }

  function formulaVariables(node, out = new Set()) {
    if (typeof node === "number") return out;
    if (node.type === "var") out.add(node.name);
    for (const key of ["t", "u", "left", "right", "child"]) {
      if (node[key] != null) formulaVariables(node[key], out);
    }
    return out;
  }

  function formulaAtoms(node, out = new Set()) {
    if (typeof node === "number") return out;
    if (node.type === "atom") out.add(node.label);
    for (const key of ["left", "right", "child"]) {
      if (node[key] != null) formulaAtoms(node[key], out);
    }
    return out;
  }

  function formulaConjuncts(node) {
    return node.type === "and"
      ? [...formulaConjuncts(node.left), ...formulaConjuncts(node.right)]
      : [node];
  }

  function durationVariables(node, out = new Set()) {
    if (typeof node === "number") return out;
    if (["box", "diamond", "box_neg", "diamond_neg"].includes(node.type)) formulaVariables(node.t, out);
    for (const key of ["left", "right", "child"]) {
      if (node[key] != null) durationVariables(node[key], out);
    }
    return out;
  }

  function queryRecord(caseData, useHalfOpen = false) {
    if (!caseData || typeof caseData !== "object") throw new Error("Case must be an object");
    const raw = caseData.supports || caseData.events;
    if (!raw || typeof raw !== "object") throw new Error("Case must contain events or supports");
    const supports = {};
    for (const [label, intervals] of Object.entries(raw)) {
      if (!Array.isArray(intervals)) throw new Error(`Invalid intervals for ${label}`);
      supports[label] = norm(intervals.map(interval => {
        const value = Array.isArray(interval)
          ? iv(interval[0], interval[1]) : interval;
        if (!value || !Number.isFinite(value.a) || !Number.isFinite(value.b) || value.a > value.b) {
          throw new Error(`Invalid interval for ${label}`);
        }
        return iv(value.a, value.b, value.lc !== false, useHalfOpen ? false : value.rc !== false);
      }));
    }
    return { id: caseData.id, supports };
  }

  function witnessPoint(IE, dataPoints) {
    for (const point of dataPoints) if (contains(IE, point)) return point;
    for (const interval of IE) {
      if (Number.isFinite(interval.a)) {
        if (contains(IE, interval.a)) return interval.a;
        if (Number.isFinite(interval.b) && contains(IE, (interval.a + interval.b) / 2)) {
          return (interval.a + interval.b) / 2;
        }
        if (contains(IE, interval.a + 1)) return interval.a + 1;
      }
      if (Number.isFinite(interval.b)) {
        if (contains(IE, interval.b)) return interval.b;
        if (contains(IE, interval.b - 1)) return interval.b - 1;
      }
      if (contains(IE, 0)) return 0;
    }
    return null;
  }

  // API for a single case: compile the string, derive finite time candidates
  // from every event endpoint, and return a satisfying assignment if one exists.
  function queryFormula(formulaString, caseData, options = {}) {
    const expression = parseFormulaString(formulaString);
    const record = queryRecord(caseData, options.halfOpen === true);
    const labels = [...formulaAtoms(expression)];
    const points = boundaryPoints(record, Object.keys(record.supports));
    const variables = [...formulaVariables(expression)];
    const positiveVariables = durationVariables(expression);
    const durations = new Set();
    for (const point of points) if (point > TOL) durations.add(point);
    for (const left of points) for (const right of points) {
      const difference = right - left;
      if (difference > TOL) durations.add(difference);
    }
    const candidates = [...durations].sort((a, b) => a - b);
    const signedCandidates = [...candidates].reverse().map(value => -value).concat([0], candidates);
    const conjuncts = formulaConjuncts(expression).map(ast => ({
      ast, variables: [...formulaVariables(ast)]
    }));
    const env = {};
    let evaluated = 0;
    const maxEvaluations = options.maxEvaluations == null ? 2000000 : options.maxEvaluations;
    if (!Number.isSafeInteger(maxEvaluations) || maxEvaluations < 1) throw new Error("maxEvaluations must be a positive integer");
    function visit(depth) {
      if (depth === variables.length) {
        const resultSupport = support(expression, env, record);
        const x = witnessPoint(resultSupport, points);
        return x == null ? null : { x, variables: { ...env }, support: resultSupport };
      }
      const variable = variables[depth];
      for (const value of positiveVariables.has(variable) ? candidates : signedCandidates) {
        evaluated++;
        if (evaluated > maxEvaluations) throw new Error(`Query exceeded ${maxEvaluations} assignments`);
        env[variable] = value;
        let possible = true;
        for (const conjunct of conjuncts) {
          if (conjunct.variables.every(name => Object.hasOwn(env, name)) &&
              witnessPoint(support(conjunct.ast, env, record), points) == null) {
            possible = false;
            break;
          }
        }
        if (possible) {
          const found = visit(depth + 1);
          if (found) return found;
        }
      }
      delete env[variable];
      return null;
    }
    // Check constant conjuncts before searching any time variable.
    for (const conjunct of conjuncts) {
      if (!conjunct.variables.length && witnessPoint(support(conjunct.ast, env, record), points) == null) {
        return { matched: false, caseId: record.id, atoms: labels, witness: null, evaluated: 0, candidateCount: candidates.length };
      }
    }
    const witness = visit(0);
    return { matched: !!witness, caseId: record.id, atoms: labels, witness, evaluated, candidateCount: candidates.length };
  }

  const GTC_BODY = and(
    box(add(V("a"), V("b")), A("S")),
    and(
      dia(V("a"), A("T")),
      shift(V("a"), dia(V("b"), A("C")))
    )
  );
  const PGES_BODY = and(
    box(add(V("a"), V("b")), A("S")),
    and(
      dia(V("a"), A("T")),
      and(
        shift(V("a"), dia(V("b"), A("C"))),
        shift(add(V("a"), V("b")), box(V("c"), A("P")))
      )
    )
  );

  const STRICT_BODY = and(
    box(STRICT_QUIET, NOEVENT),
    and(
      shift(STRICT_QUIET, box(add(V("a"), V("b")), and(A("S"), not(A("P"))))),
      and(
        shift(STRICT_QUIET, dia(V("a"), and(A("T"), not(A("C"))))),
        and(
          shift(add(STRICT_QUIET, V("a")), dia(V("b"), and(A("C"), not(A("T"))))),
          shift(
            add(add(STRICT_QUIET, V("a")), V("b")),
            box(V("c"), and(A("P"), not(A("S"))))
          )
        )
      )
    )
  );

  function evalTerm(t, env) {
    if (typeof t === "number") return t;
    if (t.type === "var") {
      if (!Number.isFinite(env[t.name])) throw new Error(`Missing numeric value for '${t.name}'`);
      return env[t.name];
    }
    if (t.type === "add") return evalTerm(t.left, env) + evalTerm(t.right, env);
    if (t.type === "sub") return evalTerm(t.left, env) - evalTerm(t.right, env);
    throw new Error("Unknown term");
  }
  function support(e, env, record) {
    switch (e.type) {
      case "atom": return record.supports[e.label] || [];
      case "noevent": return complement(Object.values(record.supports || {}).flat());
      case "and": return intersect(support(e.left, env, record), support(e.right, env, record));
      case "or": return union(support(e.left, env, record), support(e.right, env, record));
      case "not": return complement(support(e.child, env, record));
      case "box": return erode(support(e.child, env, record), evalTerm(e.t, env));
      case "diamond": return dilate(support(e.child, env, record), evalTerm(e.t, env));
      case "box_neg": return erode(complement(support(e.child, env, record)), evalTerm(e.t, env));
      case "diamond_neg": return dilate(complement(support(e.child, env, record)), evalTerm(e.t, env));
      case "shift": return displace(support(e.child, env, record), evalTerm(e.u, env));
      default: throw new Error("Unknown expression");
    }
  }

  /* ---------- witness search ---------- */
  function findUsed(record, x, a, b, c, kind) {
    const used = { S: null, T: null, C: null, P: null };
    const S = record.supports.S || [];
    const T = record.supports.T || [];
    const C = record.supports.C || [];
    const P = record.supports.P || [];
    used.S = intervalAt(S, x);
    used.T = intervalAt(T, nextPoint(T, x));
    used.C = intervalAt(C, nextPoint(C, x + a));
    if (kind === "pges") used.P = intervalAt(P, x + a + b);
    return used;
  }

  function halfOpenRecord(record) {
    const supports = {};
    for (const [label, IE] of Object.entries(record.supports || {})) {
      supports[label] = norm((IE || []).map(i => ({ ...i, rc: false })));
    }
    return { ...record, supports };
  }

  function strictACandidates(T, C, P, s0, R) {
    const values = new Set();
    const add = v => {
      if (Number.isFinite(v) && v > TOL && v < R - TOL) values.add(v);
    };
    for (const IE of [T, C, P]) {
      for (const i of IE) {
        add(i.a - s0);
        add(i.b - s0);
      }
    }
    return [...values].sort((p, q) => p - q);
  }

  function firstPointIn(IE, lo, hi) {
    for (const i of IE) {
      const a = Math.max(i.a, lo);
      const b = Math.min(i.b, hi);
      if (b < a - TOL) continue;
      for (const p of [a, (a + b) / 2, b]) {
        if (p >= lo - TOL && p <= hi + TOL && contains(IE, p)) return p;
      }
    }
    return null;
  }

  function findUsedStrict(record, x, a, b, c) {
    const formulaRecord = halfOpenRecord(record);
    const S = record.supports.S || [];
    const T = record.supports.T || [];
    const C = record.supports.C || [];
    const P = record.supports.P || [];
    const s0 = x + STRICT_QUIET;
    const e0 = s0 + a + b;
    const tOnly = support(and(A("T"), not(A("C"))), {}, formulaRecord);
    const cOnly = support(and(A("C"), not(A("T"))), {}, formulaRecord);
    const tPoint = firstPointIn(tOnly, s0, s0 + a);
    const cPoint = firstPointIn(cOnly, s0 + a, e0);
    if (tPoint == null || cPoint == null) return null;
    return {
      S: intervalAt(S, s0),
      T: intervalAt(T, tPoint),
      C: intervalAt(C, cPoint),
      P: intervalAt(P, e0)
    };
  }

  function findStrictMatches(record, query) {
    const formulaRecord = halfOpenRecord(record);
    const S = formulaRecord.supports.S || [];
    const T = formulaRecord.supports.T || [];
    const C = formulaRecord.supports.C || [];
    const P = formulaRecord.supports.P || [];
    const matches = [];
    for (let si = 0; si < S.length; si++) {
      const sIv = S[si];
      const s0 = sIv.a;
      const e0 = sIv.b;
      const R = e0 - s0;
      if (R <= EPS * 2) continue;
      const x = s0 - STRICT_QUIET;
      const as = strictACandidates(T, C, P, s0, R);
      for (const a of as) {
        if (a <= EPS) continue;
        const b = R - a;
        if (b <= EPS / 2) continue;
        const offset = s0 + a + b;
        const post = support(and(A("P"), not(A("S"))), {}, formulaRecord);
        const room = pRoom(post, offset);
        if (room == null) continue;
        if (query.cMin > 0 && room + EPS < query.cMin) continue;
        const c = room;
        const env = { x, a, b, c };
        const sup = support(STRICT_BODY, env, formulaRecord);
        if (!contains(sup, x)) continue;
        const used = findUsedStrict(record, x, a, b, c);
        if (!used) continue;
        matches.push({
          patientId: record.id,
          sIndex: si,
          x, a, b, c,
          y: offset,
          used,
          support: sup,
          strict: true,
          formula: "strict",
          sStart: s0,
          tonicEnd: s0 + a,
          offset,
          pEnd: offset + c
        });
        break;
      }
    }
    return matches;
  }

  function preferredWitness(record, kind, cMin, si) {
    const S = record.supports.S || [];
    const T = record.supports.T || [];
    const C = record.supports.C || [];
    const P = record.supports.P || [];
    const sIv = S[si];
    if (!sIv) return null;
    const x = sIv.a;
    if (!contains(S, x)) return null;
    const sEnd = componentEnd(S, x);
    if (sEnd == null) return null;
    const R = sEnd - x;
    if (R <= EPS) return null;

    for (const cv of C) {
      const a = cv.a - x;
      if (!(a > EPS && a < R - EPS)) continue;
      const b = R - a;
      if (b <= EPS) continue;
      const cStart = x + a;
      const tNext = nextPoint(T, x);
      if (tNext == null || tNext >= cStart - TOL) continue;
      if (!contains(C, cStart)) continue;

      let c = null;
      if (kind === "pges") {
        const room = pRoom(P, sEnd);
        if (room == null) continue;
        if (cMin > 0 && room + EPS < cMin) continue;
        c = room;
      }
      const env = { x, a, b, c };
      const body = kind === "pges" ? record.pgesBody : record.gtcBody;
      const sup = support(body, env, record);
      if (contains(sup, x)) {
        const used = findUsed(record, x, a, b, c, kind);
        return { patientId: record.id, sIndex: si, x, a, b, c, y: sEnd, used, support: sup, preferred: true };
      }
    }
    return null;
  }

  function boundaryPoints(record, labels) {
    const values = [];
    for (const label of labels) {
      for (const i of record.supports[label] || []) values.push(i.a, i.b);
    }
    const sorted = values.filter(Number.isFinite).sort((p, q) => p - q);
    const out = [];
    for (const v of sorted) {
      if (!out.length || Math.abs(v - out[out.length - 1]) > TOL * 10) out.push(v);
    }
    return out;
  }

  function finiteCellPoints(record, labels) {
    return boundaryPoints(record, labels);
  }

  function componentIndex(IE, point) {
    for (let i = 0; i < IE.length; i++) {
      if (contains([IE[i]], point)) return i;
    }
    return -1;
  }

  function findMatchesFiniteCell(record, query) {
    const kind = query.kind;
    const cMin = query.cMin || 0;
    const strict = !!query.strict && kind === "pges";
    const formulaRecord = strict ? halfOpenRecord(record) : record;
    const S = formulaRecord.supports.S || [];
    const T = formulaRecord.supports.T || [];
    const C = formulaRecord.supports.C || [];
    const P = formulaRecord.supports.P || [];
    if (!S.length || !T.length || !C.length) return [];
    if (kind === "pges" && !P.length) return [];

    const body = strict ? STRICT_BODY : (kind === "pges" ? PGES_BODY : GTC_BODY);
    const points = finiteCellPoints(formulaRecord, ["S", "T", "C", "P"]);
    const post = strict ? support(and(A("P"), not(A("S"))), {}, formulaRecord) : null;
    const matches = [];
    const seen = new Set();

    for (const anchor of points) {
      if (!contains(S, anchor)) continue;
      const sIndex = componentIndex(S, anchor);
      if (sIndex < 0 || seen.has(sIndex)) continue;
      const sEnd = componentEnd(S, anchor);
      if (sEnd == null) continue;
      const tNext = nextPoint(T, anchor);
      if (tNext == null) continue;

      for (const y of points) {
        if (!(y > anchor + TOL)) continue;
        if (tNext >= y - TOL) continue;
        const a = y - anchor;
        if (!(a > EPS / 2)) continue;

        for (const z of points) {
          if (!(z > y + TOL) || z > sEnd + TOL) continue;
          const b = z - y;
          if (!(b > EPS / 2)) continue;
          const cNext = nextPoint(C, y);
          if (cNext == null || cNext >= z - TOL) continue;

          let c = null;
          if (kind === "pges") {
            const room = strict ? pRoom(post, z) : pRoom(P, z);
            if (room == null) continue;
            if (cMin > 0 && room + TOL < cMin) continue;
            c = room;
          }

          const x = strict ? anchor - STRICT_QUIET : anchor;
          const env = { x, a, b, c };
          const sup = support(body, env, formulaRecord);
          if (!contains(sup, x)) continue;
          const used = strict
            ? findUsedStrict(record, x, a, b, c)
            : findUsed(record, x, a, b, c, kind);
          if (!used) continue;

          const match = {
            patientId: record.id,
            sIndex,
            x,
            a,
            b,
            c,
            y: z,
            offset: z,
            used,
            support: sup,
            preferred: false,
            finiteCell: true
          };
          if (strict) {
            match.strict = true;
            match.formula = "strict";
            match.sStart = anchor;
            match.tonicEnd = anchor + a;
            match.pEnd = z + c;
          }
          matches.push(match);
          seen.add(sIndex);
          break;
        }
        if (seen.has(sIndex)) break;
      }
    }
    return matches;
  }

  function findMatches(record, query) {
    const kind = query.kind;
    const cMin = query.cMin || 0;
    const strict = !!query.strict;
    const S = record.supports.S || [];
    const P = record.supports.P || [];
    if (strict && kind === "pges") return findStrictMatches(record, query);
    const matches = [];
    const points = boundaryPoints(record, ["S", "T", "C", "P"]);

    for (let si = 0; si < S.length; si++) {
      const sIv = S[si];
      const x = points.find(p => p >= sIv.a - TOL && p <= sIv.b + TOL && contains([sIv], p));
      if (x == null) continue;

      const pref = preferredWitness(record, kind, cMin, si);
      if (pref) { matches.push(pref); continue; }

      const sEnd = componentEnd(S, x);
      if (sEnd == null) continue;

      let found = false;
      for (const y of points) {
        if (found) break;
        if (!(y > x + TOL)) continue;
        if (y > sEnd + TOL) break;
        const a = y - x;
        if (!(a > EPS / 2)) continue;

        for (const z of points) {
          if (found) break;
          if (!(z > y + TOL) || z > sEnd + TOL) continue;
          const b = z - y;
          if (!(b > EPS / 2)) continue;

          let c = null;
          if (kind === "pges") {
            const room = pRoom(P, z);
            if (room == null) continue;
            if (cMin > 0 && room + EPS < cMin) continue;
            c = room;
          }
          const env = { x, a, b, c };
          const body = kind === "pges" ? record.pgesBody : record.gtcBody;
          const sup = support(body, env, record);
          if (contains(sup, x)) {
            const used = findUsed(record, x, a, b, c, kind);
            matches.push({ patientId: record.id, sIndex: si, x, a, b, c, y: z, used, support: sup, preferred: false });
            found = true;
          }
        }
      }
    }
    return matches;
  }

  root.QELCore = Object.freeze({
    EPS,
    TOL,
    STRICT_QUIET,
    iv,
    isEmpty,
    norm,
    contains,
    displace,
    dilate,
    erode,
    intersect,
    union,
    complement,
    intervalAt,
    nextPoint,
    componentEnd,
    pRoom,
    V,
    add,
    sub,
    A,
    box,
    dia,
    boxNeg,
    diaNeg,
    shift,
    and,
    or,
    not,
    NOEVENT,
    parseFormulaString,
    formulaToString,
    formatFormula,
    evaluateFormulaString,
    findFormulaMatches,
    queryFormula,
    GTC_BODY,
    PGES_BODY,
    STRICT_BODY,
    evalTerm,
    support,
    findUsed,
    halfOpenRecord,
    strictACandidates,
    firstPointIn,
    findUsedStrict,
    findStrictMatches,
    preferredWitness,
    findMatches,
    boundaryPoints,
    finiteCellPoints,
    findMatchesFiniteCell
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
