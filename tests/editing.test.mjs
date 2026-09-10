import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { host } from "./host.mjs";
import { catalog } from "../src/catalog.mjs";

function scene() {
  const h = host(os.tmpdir());
  h.run(`
    var PropertyType={PROPERTY:1,INDEXED_GROUP:2,NAMED_GROUP:3};
    var PropertyValueType={OneD:1,TwoD:2,ThreeD:3,COLOR:4,TwoD_SPATIAL:5,ThreeD_SPATIAL:6};
    var KeyframeInterpolationType={LINEAR:1,HOLD:2,BEZIER:3};
    var ParagraphJustification={LEFT_JUSTIFY:1,CENTER_JUSTIFY:2,RIGHT_JUSTIFY:3};
    function KeyframeEase(speed,influence){this.speed=speed;this.influence=influence;}
    var edits=0,opened=0,closed=0;
    app.beginUndoGroup=function(){opened++;};app.endUndoGroup=function(){closed++;};
    var p={name:'Amount',matchName:'Test Amount',propertyIndex:1,propertyType:1,propertyValueType:1,value:10,
      numKeys:0,canVaryOverTime:true,canSetExpression:true,expression:'',expressionEnabled:false,expressionError:'',hasMin:true,minValue:0,hasMax:true,maxValue:100,keys:[],
      setValue:function(v){this.value=v;edits++;},
      setValueAtTime:function(t,v){var i;edits++;for(i=0;i<this.keys.length;i++){if(this.keys[i].time===t){this.keys[i].value=v;return;}}this.keys.push({time:t,value:v,inType:1,outType:1,easeIn:[new KeyframeEase(0,33)],easeOut:[new KeyframeEase(0,33)]});this.keys.sort(function(a,b){return a.time-b.time;});this.numKeys=this.keys.length;},
      keyTime:function(i){return this.keys[i-1].time;},keyValue:function(i){return this.keys[i-1].value;},
      nearestKeyIndex:function(t){var best=0,i;for(i=1;i<this.keys.length;i++){if(Math.abs(this.keys[i].time-t)<Math.abs(this.keys[best].time-t)){best=i;}}return best+1;},
      removeKey:function(i){edits++;this.keys.splice(i-1,1);this.numKeys=this.keys.length;},
      keyInInterpolationType:function(i){return this.keys[i-1].inType;},keyOutInterpolationType:function(i){return this.keys[i-1].outType;},
      keyInTemporalEase:function(i){return this.keys[i-1].easeIn;},keyOutTemporalEase:function(i){return this.keys[i-1].easeOut;},
      isInterpolationTypeValid:function(){return true;},setInterpolationTypeAtKey:function(i,a,b){edits++;this.keys[i-1].inType=a;this.keys[i-1].outType=b;},
      setTemporalAutoBezierAtKey:function(){},setTemporalContinuousAtKey:function(){},setRovingAtKey:function(){},
      setTemporalEaseAtKey:function(i,a,b){edits++;this.keys[i-1].easeIn=a;this.keys[i-1].easeOut=b;},valueAtTime:function(){return this.value;}
    };
    var text={text:'Original',font:'TestPS',fontSize:40,fillColor:[1,1,1],applyFill:true,applyStroke:false,strokeWidth:0,tracking:0,leading:45,autoLeading:false,justification:1};
    var sourceText={value:text,numKeys:0,canSetExpression:true,expressionEnabled:false,setValue:function(v){edits++;this.value=v;}};
    var textGroup={propertyIndex:5,matchName:'ADBE Text Properties',name:'Text',propertyType:3,property:function(){return sourceText;}};
    var fx={propertyIndex:1,matchName:'Test Effect',name:'Unique Effect',propertyType:3,isEffect:true,canSetEnabled:true,enabled:true,numProperties:1,property:function(){return p;},remove:function(){edits++;}};
    var parade={propertyIndex:2,matchName:'ADBE Effect Parade',name:'Effects',propertyType:2,numProperties:1,property:function(){return fx;}};
    var comp=new CompItem();comp.id=10;comp.duration=5;comp.time=2;comp.width=640;comp.height=360;
    var l={id:20,index:1,name:'Editable',locked:false,enabled:true,startTime:0,inPoint:0,outPoint:5,parent:null,solo:false,label:1,containingComp:comp,numProperties:2,
      property:function(key){if(key===2||key==='ADBE Effect Parade'){return parade;}if(key===5||key==='ADBE Text Properties'){return textGroup;}return null;},
      moveBefore:function(other){this.index=other.index-1;edits++;},moveAfter:function(other){this.index=other.index+1;edits++;},setParentWithJump:function(other){this.parent=other||null;edits++;}};
    var other={id:21,index:2,name:'Other',locked:false,parent:null,containingComp:comp};
    comp.numLayers=2;comp.layer=function(i){return i===1?l:other;};
    // Root indexed list and named text group are intentionally separate.
    l.numProperties=1;var originalProperty=l.property;l.property=function(key){if(key===1){return parade;}return originalProperty.call(this,key);};
    comp.layers={precompose:function(indices,name){edits++;return comp;}};
    app.project={numItems:1,item:function(){return comp;}};
    app.fonts={allFonts:[[{postScriptName:'TestPS',familyName:'Test',styleName:'Regular'}]]};
    refreshProject();
    var target={path:[{index:2,matchName:'ADBE Effect Parade',name:'Effects'},{index:1,matchName:'Test Effect',name:'Unique Effect'},{index:1,matchName:'Test Amount',name:'Amount'}]};
  `);
  const call = (op, args = {}) =>
    JSON.parse(
      h.run(
        `StrictJSON.stringify(dispatch(${JSON.stringify(op)},${JSON.stringify({ projectSession: h.run("projectSession"), compositionId: 10, layerId: 20, ...args })}))`
      )
    );
  return { h, call, target: JSON.parse(h.run("StrictJSON.stringify(target)")) };
}

test("guarded paths reject changed/ambiguous groups; numeric writes validate bounds and animation", () => {
  const { h, call, target } = scene();
  assert.equal(
    call("setPropertyValue", { target, value: 42 }).property.value,
    42
  );
  const count = h.run("edits");
  assert.throws(
    () => call("setPropertyValue", { target, value: 101 }),
    /maximum/
  );
  h.run("p.expressionEnabled=true");
  assert.throws(
    () => call("setPropertyValue", { target, value: 1 }),
    /animation/
  );
  h.run("p.expressionEnabled=false;fx.name='Renamed'");
  assert.throws(
    () => call("setPropertyValue", { target, value: 1 }),
    /structure changed/
  );
  h.run("fx.name='Unique Effect';parade.numProperties=2");
  assert.throws(
    () => call("setPropertyValue", { target, value: 1 }),
    /distinct names/
  );
  assert.equal(h.run("edits"), count);
  assert.equal(h.run("opened"), h.run("closed"));
});

test("keyframe preflight, easing dimensions and exact deletion preserve unrelated keys", () => {
  const { h, call, target } = scene();
  assert.throws(
    () =>
      call("setPropertyKeyframes", {
        target,
        keyframes: [
          { time: 0, value: 0 },
          { time: 2, value: 101 }
        ]
      }),
    /maximum/
  );
  assert.equal(h.run("edits"), 0);
  assert.throws(
    () =>
      call("setPropertyKeyframes", {
        target,
        keyframes: [
          { time: 0, value: 0 },
          { time: 0, value: 1 }
        ]
      }),
    /distinct/
  );
  call("setPropertyKeyframes", {
    target,
    keyframes: [
      { time: 0, value: 0 },
      { time: 1, value: 20 },
      { time: 2, value: 100 }
    ]
  });
  const count = h.run("edits");
  assert.throws(
    () => call("deletePropertyKeyframes", { target, times: [0, 1.5] }),
    /No key/
  );
  assert.throws(
    () =>
      call("setKeyframeInterpolation", {
        target,
        times: [0, 2],
        interpolation: "bezier",
        easeIn: [
          { speed: 0, influence: 65 },
          { speed: 0, influence: 65 }
        ]
      }),
    /Ease arrays/
  );
  assert.equal(h.run("edits"), count);
  const result = call("setKeyframeInterpolation", {
    target,
    times: [0, 2],
    interpolation: "bezier",
    easeIn: [{ speed: 0, influence: 65 }],
    easeOut: [{ speed: 0, influence: 70 }]
  });
  assert.equal(result.property.keyframes[2].easeOut[0].influence, 70);
  assert.equal(result.property.keyframes[0].interpolationIn, "bezier");
  assert.deepEqual(
    call("deletePropertyKeyframes", {
      target,
      times: [0, 2]
    }).property.keyframes.map((k) => k.time),
    [1]
  );
});

test("text preserves unspecified typography and rejects missing fonts, animation and conflicting leading", () => {
  const { h, call } = scene();
  const result = call("editTextLayer", {
    properties: { text: "Updated", justification: "center" }
  });
  assert.equal(result.text.text, "Updated");
  assert.equal(result.text.fontSize, 40);
  assert.equal(result.text.justification, "center");
  const count = h.run("edits");
  assert.throws(
    () =>
      call("editTextLayer", { properties: { text: "Bad", font: "Missing" } }),
    /installed PostScript/
  );
  assert.throws(
    () =>
      call("editTextLayer", { properties: { leading: 50, autoLeading: true } }),
    /conflicts/
  );
  h.run("sourceText.numKeys=1");
  assert.throws(
    () => call("editTextLayer", { properties: { text: "Bad" } }),
    /animation/
  );
  assert.equal(h.run("edits"), count);
});

test("layer timing, parenting, ordering and precompose use explicit identities", () => {
  const { h, call } = scene();
  assert.throws(
    () => call("setLayerTiming", { timing: { inPoint: 4, outPoint: 2 } }),
    /inPoint/
  );
  assert.equal(h.run("l.inPoint"), 0);
  const moved = call("setLayerTiming", { timing: { startTime: 1 } });
  assert.equal(moved.inPoint, 1);
  assert.equal(moved.outPoint, 6);
  h.run("other.parent=l");
  assert.throws(() => call("setLayerParent", { parentLayerId: 21 }), /cycle/);
  h.run("other.parent=null");
  assert.equal(
    call("setLayerParent", { parentLayerId: 21, preserveAppearance: false })
      .parentLayerId,
    21
  );
  assert.equal(
    call("reorderLayer", { relativeLayerId: 21, placement: "after" }).index,
    3
  );
  assert.throws(
    () =>
      h.run(
        "editingPerform('precomposeLayers',{projectSession:projectSession,compositionId:10,layerIds:[20],name:'Test'})"
      ),
    /both sides/
  );
  assert.throws(
    () =>
      h.run(
        "editingPerform('precomposeLayers',{projectSession:projectSession,compositionId:10,layerIds:[20,20],name:'Test'})"
      ),
    /unique/
  );
});

test("property browsing includes named layer groups and paginates without editing", () => {
  const { h, call } = scene();
  const first = call("getLayerProperties", { limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.nextOffset, 1);
  const next = call("getLayerProperties", { offset: 1 });
  assert.equal(next.items[0].matchName, "ADBE Text Properties");
  assert.equal(next.items[0].path[0].index, 5);
  assert.equal(h.run("edits"), 0);
});

test("preview is excluded from batches and runtime checks happen before capture", () => {
  assert.ok(
    !JSON.stringify(catalog["execute-batch"].inputSchema).includes(
      '"captureCompositionFrame"'
    )
  );
  const { h } = scene();
  assert.throws(
    () =>
      h.run(
        "editingPerform('captureCompositionFrame',{projectSession:projectSession,compositionId:10,time:5})"
      ),
    /before composition end/
  );
  h.run("comp.width=10000;comp.height=10000");
  assert.throws(
    () =>
      h.run(
        "editingPerform('captureCompositionFrame',{projectSession:projectSession,compositionId:10,time:1})"
      ),
    /million pixels/
  );
});
