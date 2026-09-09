import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { host } from "./host.mjs";

test("duplicate response reports the original layer's resulting index", () => {
  const h = host(os.tmpdir());
  h.run(`var originalLayer={id:5,index:1,name:'Original',duplicate:function(){this.index=2;return {id:6,index:1,name:'Original 2'};}};
    findLayer=function(){return originalLayer;};
    layerInfo=function(layer){return {layerId:layer.id,index:layer.index,name:layer.name};};`);
  const result = JSON.parse(h.run(`StrictJSON.stringify(perform('duplicateLayer',{name:'Copy'}))`));
  assert.equal(result.original.index, 2);
  assert.equal(result.duplicate.index, 1);
  assert.equal(result.duplicate.name, "Copy");
});

test("explicit missing targets never fall back to active composition; session changes invalidate IDs", () => {
  const h = host(os.tmpdir());
  h.run(
    `var edits=0; var comp=new CompItem();comp.id=10;comp.name='Safe';comp.numLayers=0;app.project={numItems:1,activeItem:comp,item:function(){return comp;}}; refreshProject();`
  );
  assert.throws(
    () => h.run(`findComp({projectSession:projectSession,compositionId:999})`),
    /does not exist/
  );
  h.run("var previous=projectSession;app.project={numItems:0};");
  assert.throws(
    () => h.run("checkProject({projectSession:previous})"),
    /session changed/
  );
});
test("undo groups close on exceptions and batch exposes partial completion and skipped items", () => {
  const h = host(os.tmpdir());
  h.run(
    `var opened=0,closed=0,called=0;app.beginUndoGroup=function(){opened++;};app.endUndoGroup=function(){closed++;};perform=function(op,a){called++;if(a.name==='fail'){throw new Error('AE failure');}return {name:a.name};};`
  );
  const op = (name) => ({
    operation: "createComposition",
    arguments: {
      projectSession: "test",
      name,
      width: 1920,
      height: 1080,
      duration: 5,
      frameRate: 30
    }
  });
  const args = { operations: [op("first"), op("fail"), op("third")] };
  const result = h.run(
    `var caught;try {dispatch('batch',StrictJSON.parse(${JSON.stringify(JSON.stringify(args))}));}catch(e){caught=e;}StrictJSON.stringify(caught.data)`
  );
  assert.deepEqual(
    JSON.parse(result).results.map((r) => r.status),
    ["success", "error", "skipped"]
  );
  assert.equal(h.run("opened"), 2);
  assert.equal(h.run("closed"), 2);
  args.stopOnError = false;
  const continued = h.run(
    `try {dispatch('batch',StrictJSON.parse(${JSON.stringify(JSON.stringify(args))}));}catch(e){caught=e;}StrictJSON.stringify(caught.data)`
  );
  assert.deepEqual(
    JSON.parse(continued).results.map((r) => r.status),
    ["success", "error", "success"]
  );
});
test("batch validates entire payload before any mutation; exact dimensions and locked layers", () => {
  const h = host(os.tmpdir());
  h.run("var mutations=0;perform=function(){mutations++;};");
  assert.throws(() =>
    h.run(
      `dispatch('batch',{operations:[{operation:'createComposition',arguments:{}}]})`
    )
  );
  assert.equal(h.run("mutations"), 0);
  assert.throws(
    () => h.run(`checkValue({value:[0,0,0]},[1,2],'position')`),
    /exactly 3/
  );
  assert.throws(() => h.run(`checkValue({value:0},120,'opacity')`), /0–100/);
  h.run(
    `var c=new CompItem();c.id=1;c.numLayers=1;c.layer=function(){return {id:2,locked:true};};app.project={numItems:1,item:function(){return c;}};refreshProject();`
  );
  assert.throws(
    () =>
      h.run(
        `findLayer({projectSession:projectSession,compositionId:1,layerId:2},true)`
      ),
    /Unlock/
  );
});
