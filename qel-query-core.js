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
  const A = label => ({ type: "atom", label });
  const box = (t, child) => ({ type: "box", t, child });
  const dia = (t, child) => ({ type: "diamond", t, child });
  const shift = (u, child) => ({ type: "shift", u, child });
  const and = (left, right) => ({ type: "and", left, right });
  const or = (left, right) => ({ type: "or", left, right });
  const not = child => ({ type: "not", child });
  const NOEVENT = { type: "noevent" };

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
    if (t.type === "var") return env[t.name];
    if (t.type === "add") return evalTerm(t.left, env) + evalTerm(t.right, env);
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
    const values = new Set([EPS, R - EPS, R / 2]);
    const add = v => {
      if (v > EPS / 2 && v < R - EPS / 2) values.add(+v.toFixed(6));
    };
    for (const IE of [T, C, P]) {
      for (const i of IE) {
        for (const endpoint of [i.a, i.b]) {
          add(endpoint - s0);
          add(endpoint - s0 + EPS);
          add(endpoint - s0 - EPS);
        }
      }
    }
    const sorted = [...values].sort((p, q) => p - q);
    const out = [...sorted];
    for (let i = 0; i < sorted.length - 1; i++) {
      out.push(+((sorted[i] + sorted[i + 1]) / 2).toFixed(6));
    }
    return [...new Set(out)]
      .filter(v => v > EPS / 2 && v < R - EPS / 2)
      .sort((p, q) => p - q);
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
      const s0 = sIv.lc ? sIv.a : sIv.a + EPS;
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
    const x = sIv.lc ? sIv.a : sIv.a + EPS;
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

  function finiteCellPoints(record, labels) {
    const values = [];
    for (const label of labels) {
      for (const i of record.supports[label] || []) values.push(i.a, i.b);
    }
    const sorted = values.filter(Number.isFinite).sort((p, q) => p - q);
    const bounds = [];
    for (const v of sorted) {
      if (!bounds.length || Math.abs(v - bounds[bounds.length - 1]) > TOL * 10) bounds.push(v);
    }
    if (!bounds.length) return [];
    const out = [bounds[0] - 1, bounds[bounds.length - 1] + 1];
    for (const v of bounds) out.push(v - EPS, v, v + EPS);
    for (let i = 0; i < bounds.length - 1; i++) {
      const d = bounds[i + 1] - bounds[i];
      if (d > TOL * 10) {
        for (let k = 1; k <= 3; k++) out.push(bounds[i] + d * k / 4);
      }
    }
    out.sort((p, q) => p - q);
    return out.filter((v, i) => i === 0 || Math.abs(v - out[i - 1]) > TOL * 10);
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
      const yCandidates = points.concat([anchor + EPS, anchor + 2 * EPS, anchor + 3 * EPS]);

      for (const y of yCandidates) {
        if (!(y > anchor + TOL)) continue;
        if (tNext >= y - TOL) continue;
        const a = y - anchor;
        if (!(a > EPS / 2)) continue;
        const zCandidates = points.concat([y + EPS, y + 2 * EPS, y + 3 * EPS]);

        for (const z of zCandidates) {
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
    const T = record.supports.T || [];
    const C = record.supports.C || [];
    const P = record.supports.P || [];
    if (strict && kind === "pges") return findStrictMatches(record, query);
    const matches = [];

    for (let si = 0; si < S.length; si++) {
      const sIv = S[si];
      const x = sIv.lc ? sIv.a : sIv.a + EPS;
      if (!contains(S, x)) continue;

      const pref = preferredWitness(record, kind, cMin, si);
      if (pref) { matches.push(pref); continue; }

      const sEnd = componentEnd(S, x);
      if (sEnd == null) continue;
      const R = sEnd - x;
      if (R <= EPS) continue;

      const tNext = nextPoint(T, x);
      if (tNext == null) continue;

      const aMin = Math.max(EPS, tNext - x + EPS);
      const aSet = new Set();
      const addA = v => {
        if (Number.isFinite(v) && v > EPS / 2 && v < R - EPS / 2) aSet.add(+v.toFixed(6));
      };
      addA(EPS);
      addA(aMin);
      addA(R - EPS);
      addA((aMin + R) / 2);
      for (const cv of C) {
        addA(cv.a - x + EPS);
        addA(cv.a - x - EPS);
        addA(cv.b - x + EPS);
        addA(cv.b - x - EPS);
      }

      const as = [...aSet].sort((p, q) => p - q);
      let found = false;
      for (const a of as) {
        if (found) break;
        const cStart = x + a;
        const cNext = nextPoint(C, cStart);
        if (cNext == null) continue;
        const bMin = Math.max(EPS, cNext - cStart + EPS);
        const maxB = R - a;
        if (bMin > maxB + EPS) continue;

        const bSet = new Set();
        const addB = v => {
          if (Number.isFinite(v) && v > EPS / 2 && v <= maxB + EPS / 2) bSet.add(+v.toFixed(6));
        };
        addB(bMin);
        addB(maxB);
        addB((bMin + maxB) / 2);
        if (kind === "pges") {
          for (const pv of P) {
            addB(pv.a - cStart + EPS);
            addB(pv.a - cStart - EPS);
            addB(pv.b - cStart - EPS);
            addB(pv.b - cStart + EPS);
          }
        }

        const bs = [...bSet].sort((p, q) => p - q);
        for (const b of bs) {
          const y = cStart + b;
          let c = null;
          if (kind === "pges") {
            const room = pRoom(P, y);
            if (room == null) continue;
            if (cMin > 0 && room + EPS < cMin) continue;
            c = room;
          }
          const env = { x, a, b, c };
          const body = kind === "pges" ? record.pgesBody : record.gtcBody;
          const sup = support(body, env, record);
          if (contains(sup, x)) {
            const used = findUsed(record, x, a, b, c, kind);
            const candidate = { patientId: record.id, sIndex: si, x, a, b, c, y, used, support: sup, preferred: false };
            matches.push(candidate);
            found = true;
            break;
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
    A,
    box,
    dia,
    shift,
    and,
    or,
    not,
    NOEVENT,
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
    finiteCellPoints,
    findMatchesFiniteCell
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
