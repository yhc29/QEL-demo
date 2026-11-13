const assert = require('node:assert/strict');
require('../qel-query-core.js');
const q = globalThis.QELCore;
function record(events) {
  return { id:'test', events, supports:Object.fromEntries(Object.entries(events).map(([k,v]) => [k, v.map(i => q.iv(...i))])), pgesBody:q.PGES_BODY, gtcBody:q.GTC_BODY };
}
const query = {kind:'pges',cMin:0};
const example = record({S:[[0,2]],T:[[0,2]],C:[[0,2]],P:[[2,3]]});
assert.equal(q.findMatches(example,query).length,0);
assert.equal(q.findMatchesFiniteCell(example,query).length,0);
assert.equal(q.findMatchesComplete(example,query).length,1);
assert.equal(q.findMatchesComplete(example,{...query,strict:true}).length,0);
assert.equal(q.findMatchesComplete(example,{...query,cMin:1}).length,1);
assert.equal(q.findMatchesComplete(example,{...query,cMin:1.1}).length,0);
const tiny=record({S:[[0,0.00000000001]],T:[[0,0.00000000001]],C:[[0,0.00000000001]],P:[[0.00000000001,0.00000000002]]});
assert.equal(q.findMatchesComplete(tiny,query).length,1);
const impossible=record({S:[[0,2]],T:[[2,2]],C:[[0,2]],P:[[2,3]]});
assert.equal(q.findMatchesComplete(impossible,query).length,0);
const endAtAnchor=record({S:[[0,2]],T:[[-1,0]],C:[[0,2]],P:[[2,3]]});
assert.equal(q.findMatchesComplete(endAtAnchor,query).length,0);
const emptyT=record({S:[[0,2]],T:[[0,0]],C:[[0,2]],P:[[2,3]]});
assert.equal(q.findMatchesComplete(emptyT,query).length,0);
assert.equal(q.contains([q.iv(0,2)],2),false);
assert.equal(q.contains([q.iv(0,2)],0),true);
const data=require('../pges-manual-eval.json');
for(const c of data.cases) {
  const r=record(c.events); r.id=c.id;
  for(const strict of [false,true]) {
    const expected=strict ? c.expected_strict : c.expected;
    if(expected) assert.equal(q.findMatchesComplete(r,{...query,strict}).length>0,expected.shouldMatch,`${c.id} strict=${strict}`);
  }
}
console.log('Complete PGES regression and 54-case expectations passed');
