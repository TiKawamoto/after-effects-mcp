// AE operation implementations. ES3 only. IDs are scoped to a panel/project session.
var projectObject = null,
  projectSession = "",
  transformNames = {
    position: "ADBE Position",
    anchorPoint: "ADBE Anchor Point",
    scale: "ADBE Scale",
    rotation: "ADBE Rotate Z",
    opacity: "ADBE Opacity"
  };
function refreshProject() {
  if (projectObject !== app.project || !projectSession) {
    projectObject = app.project;
    projectSession =
      panelId +
      "-" +
      String(new Date().getTime()) +
      "-" +
      String(Math.floor(Math.random() * 1000000000));
  }
  return projectSession;
}
function operationError(code, message) {
  var e = new Error(message);
  e.code = code;
  throw e;
}
function checkProject(a) {
  refreshProject();
  if (a.projectSession !== projectSession) {
    operationError(
      "PROJECT_CHANGED",
      "Project or panel session changed. Inspect again and use the new projectSession and IDs."
    );
  }
  if (!app.project) {
    operationError("NO_PROJECT", "Open a project first.");
  }
}
function findComp(a) {
  checkProject(a);
  var i, item;
  for (i = 1; i <= app.project.numItems; i++) {
    item = app.project.item(i);
    if (item.id === a.compositionId && item instanceof CompItem) {
      return item;
    }
  }
  operationError(
    "TARGET_NOT_FOUND",
    "Composition ID " +
      a.compositionId +
      " does not exist. No active-composition fallback."
  );
}
function findLayer(a, mutating) {
  var c = findComp(a),
    i,
    l;
  for (i = 1; i <= c.numLayers; i++) {
    l = c.layer(i);
    if (l.id === a.layerId) {
      if (mutating && l.locked) {
        operationError(
          "LAYER_LOCKED",
          "Unlock the intended layer before editing."
        );
      }
      return l;
    }
  }
  operationError(
    "TARGET_NOT_FOUND",
    "Layer ID " +
      a.layerId +
      " does not exist in composition " +
      a.compositionId +
      "."
  );
}
function compInfo(c) {
  return {
    projectSession: refreshProject(),
    compositionId: c.id,
    name: c.name,
    width: c.width,
    height: c.height,
    duration: c.duration,
    frameRate: c.frameRate,
    pixelAspect: c.pixelAspect,
    layerCount: c.numLayers
  };
}
function transformProperty(l, name) {
  var t = l.property("ADBE Transform Group"),
    p = t && t.property(transformNames[name]);
  if (!p) {
    operationError(
      "UNSUPPORTED_PROPERTY",
      "Transform property unavailable: " + name
    );
  }
  if (p.isSeparationLeader && p.dimensionsSeparated) {
    operationError(
      "SEPARATED_DIMENSIONS",
      "Separated position dimensions are not supported in this milestone."
    );
  }
  return p;
}
function checkValue(p, value, name) {
  var current = p.value,
    i;
  if (current instanceof Array) {
    if (!(value instanceof Array) || value.length !== current.length) {
      operationError(
        "DIMENSION_MISMATCH",
        name + " requires exactly " + current.length + " numbers."
      );
    }
  } else if (typeof value !== "number") {
    operationError("DIMENSION_MISMATCH", name + " requires a scalar number.");
  }
  if (name === "opacity" && (value < 0 || value > 100)) {
    operationError("INVALID_VALUE", "Opacity must be 0–100.");
  }
  if (p.hasMin && typeof value === "number" && value < p.minValue) {
    operationError("INVALID_VALUE", "Below AE property minimum.");
  }
  if (p.hasMax && typeof value === "number" && value > p.maxValue) {
    operationError("INVALID_VALUE", "Above AE property maximum.");
  }
}
function propertyInfo(p) {
  var keys = [],
    i;
  if (p.numKeys > 2000) {
    operationError(
      "INSPECTION_LIMIT",
      "Property has more than 2000 keys; inspect manually."
    );
  }
  for (i = 1; i <= p.numKeys; i++) {
    keys.push({ time: p.keyTime(i), value: p.keyValue(i) });
  }
  return {
    value: p.value,
    valueDimensions: p.value instanceof Array ? p.value.length : 1,
    keyframes: keys,
    expression: p.canSetExpression ? p.expression : "",
    expressionEnabled: p.canSetExpression ? p.expressionEnabled : false,
    expressionError: p.canSetExpression ? p.expressionError : ""
  };
}
function layerInfo(l, detail) {
  var result = {
      projectSession: refreshProject(),
      compositionId: l.containingComp.id,
      layerId: l.id,
      index: l.index,
      name: l.name,
      locked: l.locked,
      enabled: l.enabled,
      inPoint: l.inPoint,
      outPoint: l.outPoint,
      threeDLayer: l.threeDLayer
    },
    k,
    t,
    p,
    effects,
    i,
    e;
  if (typeof l.id !== "number") {
    operationError(
      "AE_VERSION_UNSUPPORTED",
      "Stable layer IDs require AE 22 or later."
    );
  }
  if (!detail) {
    return result;
  }
  result.transforms = {};
  t = l.property("ADBE Transform Group");
  for (k in transformNames) {
    if (Object.prototype.hasOwnProperty.call(transformNames, k)) {
      p = t && t.property(transformNames[k]);
      if (p && !(p.isSeparationLeader && p.dimensionsSeparated)) {
        result.transforms[k] = propertyInfo(p);
      }
    }
  }
  result.effects = [];
  effects = l.property("ADBE Effect Parade");
  if (effects) {
    for (i = 1; i <= effects.numProperties; i++) {
      e = effects.property(i);
      result.effects.push({
        index: i,
        name: e.name,
        matchName: e.matchName,
        color:
          e.matchName === "ADBE Fill"
            ? e.property("ADBE Fill-0002").value
            : null
      });
    }
  }
  p = l.property("ADBE Text Properties");
  if (p) {
    p = p.property("ADBE Text Document").value;
    result.text = {
      text: p.text,
      font: p.font,
      fontSize: p.fontSize,
      color: p.fillColor
    };
  }
  return result;
}
function listComps() {
  var items = [],
    i,
    c;
  if (app.project) {
    for (i = 1; i <= app.project.numItems; i++) {
      c = app.project.item(i);
      if (c instanceof CompItem) {
        items.push(compInfo(c));
      }
    }
  }
  return { projectSession: refreshProject(), compositions: items };
}
function perform(operation, a) {
  var c, l, p, k, i, t, d, group, contents, shape, fill, original, info;
  if (operation === "status") {
    return {
      connected: true,
      aeVersion: app.version,
      bridgeVersion: AE_VERSION,
      protocolVersion: AE_PROTOCOL,
      bridgeDirectory: root.fsName,
      panelId: panelId,
      projectSession: refreshProject()
    };
  }
  if (operation === "getProjectInfo") {
    d = listComps();
    d.name = app.project && app.project.file ? app.project.file.name : null;
    d.itemCount = app.project ? app.project.numItems : 0;
    return d;
  }
  if (operation === "listCompositions") {
    return listComps();
  }
  if (operation === "getCompositionInfo") {
    c = findComp(a);
    d = compInfo(c);
    d.layers = [];
    for (i = 1; i <= c.numLayers; i++) {
      d.layers.push(layerInfo(c.layer(i), false));
    }
    return d;
  }
  if (operation === "getLayerInfo") {
    return layerInfo(findLayer(a, false), true);
  }
  if (operation === "createComposition") {
    checkProject(a);
    c = app.project.items.addComp(
      a.name,
      a.width,
      a.height,
      a.pixelAspect === undefined ? 1 : a.pixelAspect,
      a.duration,
      a.frameRate
    );
    return compInfo(c);
  }
  if (
    operation === "createTextLayer" ||
    operation === "createShapeLayer" ||
    operation === "createSolidLayer"
  ) {
    c = findComp(a);
    if (operation === "createTextLayer") {
      l = c.layers.addText(a.text);
      p = l.property("ADBE Text Properties").property("ADBE Text Document");
      d = p.value;
      d.fontSize = a.fontSize === undefined ? 72 : a.fontSize;
      d.fillColor = a.color || [1, 1, 1];
      p.setValue(d);
    } else if (operation === "createSolidLayer") {
      l = c.layers.addSolid(
        a.color,
        a.name,
        c.width,
        c.height,
        c.pixelAspect,
        c.duration
      );
    } else {
      l = c.layers.addShape();
      group = l
        .property("ADBE Root Vectors Group")
        .addProperty("ADBE Vector Group");
      contents = group.property("ADBE Vectors Group");
      shape = contents.addProperty(
        a.shape === "rectangle"
          ? "ADBE Vector Shape - Rect"
          : "ADBE Vector Shape - Ellipse"
      );
      shape
        .property(
          a.shape === "rectangle"
            ? "ADBE Vector Rect Size"
            : "ADBE Vector Ellipse Size"
        )
        .setValue(a.size);
      fill = contents.addProperty("ADBE Vector Graphic - Fill");
      fill.property("ADBE Vector Fill Color").setValue(a.color);
    }
    if (a.name !== undefined) {
      l.name = a.name;
    }
    if (a.position) {
      transformProperty(l, "position").setValue(a.position);
    }
    return layerInfo(l, true);
  }
  l = findLayer(a, true);
  c = l.containingComp;
  if (operation === "setLayerProperties") {
    // Validate every destination before the first edit. AE can still fail mid-operation.
    for (k in a.properties) {
      if (
        Object.prototype.hasOwnProperty.call(a.properties, k) &&
        transformNames[k]
      ) {
        p = transformProperty(l, k);
        checkValue(p, a.properties[k], k);
        if (p.numKeys || (p.canSetExpression && p.expressionEnabled)) {
          operationError(
            "PROPERTY_ANIMATED",
            "Use keyframes/expressions to edit " +
              k +
              "; static set would be ambiguous."
          );
        }
      }
    }
    for (k in a.properties) {
      if (Object.prototype.hasOwnProperty.call(a.properties, k)) {
        if (k === "name" || k === "enabled") {
          l[k] = a.properties[k];
        } else {
          transformProperty(l, k).setValue(a.properties[k]);
        }
      }
    }
    return layerInfo(l, true);
  }
  if (operation === "setLayerKeyframe") {
    p = transformProperty(l, a.property);
    checkValue(p, a.value, a.property);
    if (a.time > c.duration) {
      operationError(
        "INVALID_TIME",
        "Keyframe time exceeds composition duration."
      );
    }
    if (!p.canVaryOverTime || (p.canSetExpression && p.expressionEnabled)) {
      operationError(
        "PROPERTY_UNAVAILABLE",
        "Property cannot be keyed, or has an enabled expression."
      );
    }
    p.setValueAtTime(a.time, a.value);
    return {
      layer: layerInfo(l, false),
      property: a.property,
      result: propertyInfo(p)
    };
  }
  if (operation === "setLayerExpression") {
    p = transformProperty(l, a.property);
    if (!p.canSetExpression) {
      operationError(
        "UNSUPPORTED_PROPERTY",
        "Property cannot accept an expression."
      );
    }
    p.expression = a.expression;
    p.valueAtTime(c.time, false);
    if (p.expressionError) {
      operationError("EXPRESSION_ERROR", p.expressionError);
    }
    return {
      layer: layerInfo(l, false),
      property: a.property,
      result: propertyInfo(p)
    };
  }
  if (operation === "applyEffect") {
    p = l.property("ADBE Effect Parade");
    if (!p || !p.canAddProperty(a.effect)) {
      operationError(
        "EFFECT_UNAVAILABLE",
        "ADBE Fill cannot be added to this layer."
      );
    }
    p = p.addProperty(a.effect);
    p.property("ADBE Fill-0002").setValue([
      a.color[0],
      a.color[1],
      a.color[2],
      1
    ]);
    return {
      layer: layerInfo(l, false),
      effect: {
        index: p.propertyIndex,
        matchName: p.matchName,
        color: p.property("ADBE Fill-0002").value
      }
    };
  }
  if (operation === "duplicateLayer") {
    original = l;
    l = l.duplicate();
    if (a.name !== undefined) {
      l.name = a.name;
    }
    return { original: layerInfo(original, false), duplicate: layerInfo(l, true) };
  }
  if (operation === "deleteLayer") {
    info = layerInfo(l, false);
    l.remove();
    return { deleted: info };
  }
  operationError("UNSUPPORTED_OPERATION", "No implementation: " + operation);
}
function findSpec(operation) {
  var k;
  for (k in AE_CATALOG) {
    if (
      Object.prototype.hasOwnProperty.call(AE_CATALOG, k) &&
      AE_CATALOG[k].operation === operation
    ) {
      return AE_CATALOG[k];
    }
  }
  operationError(
    "UNSUPPORTED_OPERATION",
    "Unsupported operation: " + operation
  );
}
function dispatch(operation, args) {
  var spec = findSpec(operation),
    result,
    opened = false,
    i,
    entry,
    results = [],
    failed = false,
    stopped = false;
  validate(spec.inputSchema, args, "arguments");
  if (operation === "batch") {
    for (i = 0; i < args.operations.length; i++) {
      entry = args.operations[i];
      if (stopped) {
        results.push({
          index: i,
          operation: entry.operation,
          status: "skipped"
        });
        continue;
      }
      try {
        result = dispatch(entry.operation, entry.arguments);
        results.push({
          index: i,
          operation: entry.operation,
          status: "success",
          data: result
        });
      } catch (e) {
        failed = true;
        results.push({
          index: i,
          operation: entry.operation,
          status: "error",
          error: {
            code: e.code || "AE_ERROR",
            message: String(e),
            mayHaveChanged: !findSpec(entry.operation).annotations.readOnlyHint
          }
        });
        if (args.stopOnError !== false) {
          stopped = true;
        }
      }
    }
    if (failed) {
      var err = new Error(
        "Batch partially completed. Inspect individual results; no rollback."
      );
      err.code = "BATCH_PARTIAL_FAILURE";
      err.data = { results: results };
      throw err;
    }
    return { results: results };
  }
  try {
    if (!spec.annotations.readOnlyHint) {
      app.beginUndoGroup("MCP: " + operation);
      opened = true;
    }
    return perform(operation, args);
  } finally {
    if (opened) {
      app.endUndoGroup();
    }
  }
}
