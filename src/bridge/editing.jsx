// Structured editing extensions. Resolve guarded property paths afresh for every call.
var editingOperations = {
  listEffects: 1,
  listFonts: 1,
  getLayerProperties: 1,
  getPropertyInfo: 1,
  setPropertyValue: 1,
  setPropertyKeyframes: 1,
  setKeyframeInterpolation: 1,
  deletePropertyKeyframes: 1,
  setPropertyExpression: 1,
  editTextLayer: 1,
  setLayerTiming: 1,
  reorderLayer: 1,
  setLayerParent: 1,
  precomposeLayers: 1,
  createNullLayer: 1,
  setLayerSwitches: 1,
  addEffect: 1,
  editEffect: 1,
  removeEffect: 1,
  captureCompositionFrame: 1
};
function own(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}
function guardedProperty(l, path) {
  var p = l,
    i,
    step,
    group,
    j,
    sibling,
    duplicates;
  for (i = 0; i < path.length; i++) {
    step = path[i];
    group = p;
    p = p.property(step.index);
    if (!p || p.matchName !== step.matchName || p.name !== step.name) {
      operationError(
        "PROPERTY_PATH_CHANGED",
        "Property structure changed. Inspect again before editing."
      );
    }
    if (i > 0 && group.propertyType === PropertyType.INDEXED_GROUP) {
      duplicates = 0;
      for (j = 1; j <= group.numProperties; j++) {
        sibling = group.property(j);
        if (
          sibling.matchName === step.matchName &&
          sibling.name === step.name
        ) {
          duplicates++;
        }
      }
      if (duplicates > 1) {
        operationError(
          "AMBIGUOUS_PROPERTY",
          "Identically named siblings cannot be targeted safely. Give them distinct names in AE and inspect again."
        );
      }
    }
  }
  return p;
}
function selectedProperty(l, target) {
  return target.transform
    ? transformProperty(l, target.transform)
    : guardedProperty(l, target.path);
}
function propertyKind(p) {
  var v = p.propertyValueType;
  if (typeof PropertyValueType === "undefined") {
    return "unsupported";
  }
  if (v === PropertyValueType.OneD) {
    return "scalar";
  }
  if (v === PropertyValueType.TwoD || v === PropertyValueType.TwoD_SPATIAL) {
    return "vector2";
  }
  if (
    v === PropertyValueType.ThreeD ||
    v === PropertyValueType.ThreeD_SPATIAL
  ) {
    return "vector3";
  }
  if (v === PropertyValueType.COLOR) {
    return "color";
  }
  return "unsupported";
}
function numericProperty(p) {
  if (p.numKeys > 2000) {
    operationError(
      "INSPECTION_LIMIT",
      "Property has more than 2000 keys; narrow or simplify it in AE first."
    );
  }
  if (propertyKind(p) === "unsupported") {
    operationError(
      "UNSUPPORTED_PROPERTY",
      "Only numeric, vector and color values are supported. Use dedicated text tools for Source Text."
    );
  }
  if (p.isSeparationLeader && p.dimensionsSeparated) {
    operationError(
      "SEPARATED_DIMENSIONS",
      "Browse and target individual separated dimension followers."
    );
  }
  return p;
}
function checkNumericValue(p, value) {
  numericProperty(p);
  checkValue(p, value, p.matchName);
  var i,
    values = value instanceof Array ? value : [value];
  for (i = 0; i < values.length; i++) {
    if (typeof values[i] !== "number" || !isFinite(values[i])) {
      operationError("INVALID_VALUE", "Finite numeric values required.");
    }
    if (propertyKind(p) === "color" && (values[i] < 0 || values[i] > 1)) {
      operationError("INVALID_VALUE", "RGBA channels must be 0–1.");
    }
    if (p.hasMin && values[i] < p.minValue) {
      operationError("INVALID_VALUE", "Below property minimum.");
    }
    if (p.hasMax && values[i] > p.maxValue) {
      operationError("INVALID_VALUE", "Above property maximum.");
    }
  }
}
function requireStatic(p) {
  if (p.numKeys || (p.canSetExpression && p.expressionEnabled)) {
    operationError(
      "PROPERTY_ANIMATED",
      "Static editing would replace animation. Use explicit keyframe/expression tools."
    );
  }
}
function requireKeyable(p) {
  numericProperty(p);
  if (!p.canVaryOverTime || (p.canSetExpression && p.expressionEnabled)) {
    operationError(
      "PROPERTY_UNAVAILABLE",
      "Property cannot be keyed or has an enabled expression."
    );
  }
}
function interpolationName(v) {
  if (v === KeyframeInterpolationType.LINEAR) {
    return "linear";
  }
  if (v === KeyframeInterpolationType.HOLD) {
    return "hold";
  }
  if (v === KeyframeInterpolationType.BEZIER) {
    return "bezier";
  }
  return "unknown";
}
function easeInfo(eases) {
  var result = [],
    i;
  for (i = 0; i < eases.length; i++) {
    result.push({ speed: eases[i].speed, influence: eases[i].influence });
  }
  return result;
}
function numericInfo(p) {
  numericProperty(p);
  var result = propertyInfo(p),
    i;
  result.kind = propertyKind(p);
  result.matchName = p.matchName;
  result.name = p.name;
  result.canVaryOverTime = p.canVaryOverTime;
  result.minimum = p.hasMin ? p.minValue : null;
  result.maximum = p.hasMax ? p.maxValue : null;
  result.temporalEaseDimensions =
    p.isSpatial || propertyKind(p) === "color" ? 1 : result.valueDimensions;
  // Colors, spatial properties and some plug-ins use one temporal ease component.
  if (p.numKeys) {
    result.temporalEaseDimensions = p.keyInTemporalEase(1).length;
  }
  for (i = 1; i <= p.numKeys; i++) {
    result.keyframes[i - 1].interpolationIn = interpolationName(
      p.keyInInterpolationType(i)
    );
    result.keyframes[i - 1].interpolationOut = interpolationName(
      p.keyOutInterpolationType(i)
    );
    result.keyframes[i - 1].easeIn = easeInfo(p.keyInTemporalEase(i));
    result.keyframes[i - 1].easeOut = easeInfo(p.keyOutTemporalEase(i));
  }
  return result;
}
function exactKeys(p, times) {
  var result = [],
    i,
    j,
    index;
  for (i = 0; i < times.length; i++) {
    if (!p.numKeys) {
      operationError("KEYFRAME_NOT_FOUND", "No key at requested time.");
    }
    index = p.nearestKeyIndex(times[i]);
    if (Math.abs(p.keyTime(index) - times[i]) > 0.000001) {
      operationError(
        "KEYFRAME_NOT_FOUND",
        "No key at " + times[i] + " seconds."
      );
    }
    for (j = 0; j < result.length; j++) {
      if (result[j] === index) {
        operationError("DUPLICATE_TIME", "Times must identify distinct keys.");
      }
    }
    result.push(index);
  }
  return result;
}
function makeEases(values) {
  var result = [],
    i;
  for (i = 0; i < values.length; i++) {
    result.push(new KeyframeEase(values[i].speed, values[i].influence));
  }
  return result;
}
function pageResult(items, a) {
  var offset = a.offset || 0,
    limit = a.limit || 50;
  return {
    total: items.length,
    offset: offset,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    items: items.slice(offset, offset + limit)
  };
}
function fontItems() {
  if (!app.fonts || !app.fonts.allFonts) {
    operationError(
      "CAPABILITY_UNAVAILABLE",
      "This AE version does not expose installed fonts."
    );
  }
  var all = app.fonts.allFonts,
    result = [],
    i,
    j,
    f;
  for (i = 0; i < all.length; i++) {
    for (j = 0; j < all[i].length; j++) {
      f = all[i][j];
      result.push({
        postScriptName: f.postScriptName,
        familyName: f.familyName,
        styleName: f.styleName
      });
    }
  }
  return result;
}
function textDetails(d) {
  var justification = "other";
  if (typeof ParagraphJustification !== "undefined") {
    if (d.justification === ParagraphJustification.LEFT_JUSTIFY) {
      justification = "left";
    }
    if (d.justification === ParagraphJustification.CENTER_JUSTIFY) {
      justification = "center";
    }
    if (d.justification === ParagraphJustification.RIGHT_JUSTIFY) {
      justification = "right";
    }
  }
  return {
    text: d.text,
    font: d.font,
    fontSize: d.fontSize,
    fillColor: d.applyFill ? d.fillColor : null,
    applyFill: d.applyFill,
    strokeColor: d.applyStroke ? d.strokeColor : null,
    applyStroke: d.applyStroke,
    strokeWidth: d.strokeWidth,
    tracking: d.tracking,
    leading: d.leading,
    autoLeading: d.autoLeading,
    justification: justification
  };
}
function editingPerform(operation, a) {
  var c,
    l,
    p,
    d,
    k,
    i,
    j,
    items = [],
    query,
    matches,
    path,
    child,
    keys,
    interpolation,
    easeIn,
    easeOut,
    parent,
    cursor;
  if (operation === "listEffects" || operation === "listFonts") {
    query = (a.query || "").toLowerCase();
    matches = operation === "listEffects" ? app.effects : fontItems();
    for (i = 0; i < matches.length; i++) {
      d =
        operation === "listEffects"
          ? {
              displayName: matches[i].displayName,
              matchName: matches[i].matchName,
              category: matches[i].category
            }
          : matches[i];
      if (!query || StrictJSON.stringify(d).toLowerCase().indexOf(query) >= 0) {
        items.push(d);
      }
    }
    return pageResult(items, a);
  }
  if (operation === "captureCompositionFrame") {
    c = findComp(a);
    if (a.time >= c.duration) {
      operationError(
        "INVALID_TIME",
        "Capture time must be before composition end."
      );
    }
    if (c.width * c.height > 8300000) {
      operationError("PREVIEW_LIMIT", "Preview exceeds 8.3 million pixels.");
    }
    if (typeof c.saveFrameToPng !== "function") {
      operationError(
        "CAPABILITY_UNAVAILABLE",
        "Native PNG frame capture is unavailable in this AE version."
      );
    }
    if (
      typeof activeRequestId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(activeRequestId)
    ) {
      operationError(
        "INVALID_REQUEST",
        "Capture requires a correlated standalone request."
      );
    }
    var previewFolder = new Folder(root.fsName + "/previews");
    if (!previewFolder.exists && !previewFolder.create()) {
      operationError("PREVIEW_IO", "Cannot create preview directory.");
    }
    if (previewFolder.getFiles("*.png").length >= 64) {
      operationError(
        "PREVIEW_LIMIT",
        "Preview cache is full. Remove older preview PNGs before capturing more."
      );
    }
    var file = new File(previewFolder.fsName + "/" + activeRequestId + ".png");
    if (file.exists) {
      operationError(
        "PREVIEW_EXISTS",
        "Preview already exists. Retrieve its original result."
      );
    }
    var previousTime = c.time;
    try {
      c.saveFrameToPng(a.time, file);
    } finally {
      if (c.time !== previousTime) {
        c.time = previousTime;
      }
    }
    // AE 26.3 may finish writing after this script yields. Node waits for a complete
    // PNG (including IEND) rather than treating File.exists here as completion.
    return {
      projectSession: refreshProject(),
      compositionId: c.id,
      time: a.time,
      width: c.width,
      height: c.height,
      artifact: activeRequestId + ".png",
      mimeType: "image/png"
    };
  }
  if (operation === "precomposeLayers") {
    c = findComp(a);
    var indices = [],
      selected = {},
      oldIds = {};
    for (i = 0; i < a.layerIds.length; i++) {
      if (selected[a.layerIds[i]]) {
        operationError("DUPLICATE_TARGET", "Layer IDs must be unique.");
      }
      l = findLayer(
        {
          projectSession: a.projectSession,
          compositionId: a.compositionId,
          layerId: a.layerIds[i]
        },
        true
      );
      selected[l.id] = true;
      indices.push(l.index);
    }
    for (i = 1; i <= c.numLayers; i++) {
      l = c.layer(i);
      oldIds[l.id] = true;
      if (l.parent && !!selected[l.id] !== !!selected[l.parent.id]) {
        operationError(
          "EXTERNAL_PARENT",
          "Include both sides of parenting relationships before precomposing."
        );
      }
    }
    indices.sort(function (x, y) {
      return x - y;
    });
    var newComp = c.layers.precompose(indices, a.name, true),
      replacement = null;
    for (i = 1; i <= c.numLayers; i++) {
      l = c.layer(i);
      if (!oldIds[l.id] && l.source && l.source.id === newComp.id) {
        replacement = layerInfo(l, false);
      }
    }
    return {
      composition: compInfo(newComp),
      replacementLayer: replacement,
      sourceComposition: compInfo(c)
    };
  }
  if (operation === "createNullLayer") {
    c = findComp(a);
    l = c.layers.addNull(c.duration);
    l.name = a.name;
    return layerInfo(l, true);
  }
  l = findLayer(
    a,
    operation !== "getLayerProperties" && operation !== "getPropertyInfo"
  );
  c = l.containingComp;
  if (operation === "getLayerProperties") {
    path = a.path || [];
    p = guardedProperty(l, path);
    if (path.length && p.propertyType === PropertyType.PROPERTY) {
      operationError(
        "NOT_PROPERTY_GROUP",
        "Choose a group path to browse children."
      );
    }
    var offset = a.offset || 0,
      limit = a.limit || 50,
      total = p.numProperties,
      children = [];
    for (i = 1; i <= total; i++) {
      children.push(p.property(i));
    }
    // Layer.numProperties excludes named groups such as Transform and Text.
    if (!path.length) {
      var namedGroups = [
        "ADBE Transform Group",
        "ADBE Text Properties",
        "ADBE Root Vectors Group",
        "ADBE Audio Group",
        "ADBE Material Options Group",
        "ADBE Camera Options Group",
        "ADBE Light Options Group"
      ];
      for (i = 0; i < namedGroups.length; i++) {
        child = l.property(namedGroups[i]);
        if (child) {
          matches = false;
          for (j = 0; j < children.length; j++) {
            if (children[j].propertyIndex === child.propertyIndex) {
              matches = true;
            }
          }
          if (!matches) {
            children.push(child);
          }
        }
      }
    }
    total = children.length;
    for (i = offset + 1; i <= total && i <= offset + limit; i++) {
      child = children[i - 1];
      d = {
        index: child.propertyIndex,
        name: child.name,
        matchName: child.matchName
      };
      var childPath = path.concat([d]),
        isGroup = child.propertyType !== PropertyType.PROPERTY;
      items.push({
        path: childPath,
        name: child.name,
        matchName: child.matchName,
        isGroup: isGroup,
        kind: isGroup ? "group" : propertyKind(child),
        canSetExpression: !isGroup && child.canSetExpression,
        dimensionsSeparated: !!child.dimensionsSeparated
      });
    }
    return {
      layer: layerInfo(l, false),
      total: total,
      offset: offset,
      nextOffset: offset + limit < total ? offset + limit : null,
      items: items
    };
  }
  if (operation === "editTextLayer") {
    p = l.property("ADBE Text Properties");
    if (!p) {
      operationError("NOT_TEXT_LAYER", "Target is not a text layer.");
    }
    p = p.property("ADBE Text Document");
    requireStatic(p);
    d = p.value;
    if (own(a.properties, "font")) {
      matches = fontItems();
      j = 0;
      for (i = 0; i < matches.length; i++) {
        if (matches[i].postScriptName === a.properties.font) {
          j++;
        }
      }
      if (!j) {
        operationError(
          "FONT_UNAVAILABLE",
          "Choose an installed PostScript font name from list-fonts."
        );
      }
    }
    if (own(a.properties, "leading") && a.properties.autoLeading === true) {
      operationError(
        "INVALID_VALUE",
        "Explicit leading conflicts with autoLeading=true."
      );
    }
    for (k in a.properties) {
      if (own(a.properties, k)) {
        if (k === "justification") {
          if (a.properties.justification === "left") {
            d.justification = ParagraphJustification.LEFT_JUSTIFY;
          } else if (a.properties.justification === "right") {
            d.justification = ParagraphJustification.RIGHT_JUSTIFY;
          } else {
            d.justification = ParagraphJustification.CENTER_JUSTIFY;
          }
        } else {
          d[k] = a.properties[k];
        }
      }
    }
    if (own(a.properties, "leading")) {
      d.autoLeading = false;
    }
    p.setValue(d);
    var actualText = textDetails(p.value);
    if (
      own(a.properties, "justification") &&
      actualText.justification !== a.properties.justification
    ) {
      operationError(
        "POSTCONDITION_FAILED",
        "AE did not retain the requested text alignment. Inspect Source Text before continuing."
      );
    }
    return { layer: layerInfo(l, false), text: actualText };
  }
  if (operation === "setLayerTiming") {
    d = a.timing;
    var delta = own(d, "startTime") ? d.startTime - l.startTime : 0;
    var inPoint = own(d, "inPoint") ? d.inPoint : l.inPoint + delta;
    var outPoint = own(d, "outPoint") ? d.outPoint : l.outPoint + delta;
    if (
      outPoint <= inPoint ||
      inPoint < -10800 ||
      outPoint > 10800 ||
      outPoint < -10800 ||
      inPoint > 10800
    ) {
      operationError(
        "INVALID_TIME",
        "Require -10800 <= inPoint < outPoint <= 10800."
      );
    }
    if (own(d, "startTime")) {
      l.startTime = d.startTime;
    }
    // Expand first, then trim, to avoid transient inverted ranges.
    if (inPoint >= l.outPoint) {
      l.outPoint = outPoint;
      l.inPoint = inPoint;
    } else {
      l.inPoint = inPoint;
      l.outPoint = outPoint;
    }
    return layerInfo(l, false);
  }
  if (operation === "setLayerSwitches") {
    for (k in a.switches) {
      if (own(a.switches, k) && typeof l[k] === "undefined") {
        operationError("UNSUPPORTED_SWITCH", "Layer has no " + k + " switch.");
      }
    }
    for (k in a.switches) {
      if (own(a.switches, k)) {
        l[k] = a.switches[k];
      }
    }
    return layerInfo(l, false);
  }
  if (operation === "reorderLayer" || operation === "setLayerParent") {
    var otherId =
      operation === "reorderLayer" ? a.relativeLayerId : a.parentLayerId;
    parent = otherId
      ? findLayer(
          {
            projectSession: a.projectSession,
            compositionId: a.compositionId,
            layerId: otherId
          },
          false
        )
      : null;
    if (parent === l) {
      operationError("INVALID_TARGET", "A layer cannot target itself.");
    }
    if (operation === "reorderLayer") {
      if (a.placement === "before") {
        l.moveBefore(parent);
      } else {
        l.moveAfter(parent);
      }
    } else {
      cursor = parent;
      while (cursor) {
        if (cursor === l) {
          operationError("PARENT_CYCLE", "Parenting would create a cycle.");
        }
        cursor = cursor.parent;
      }
      if (a.preserveAppearance !== false) {
        l.parent = parent;
      } else if (parent) {
        l.setParentWithJump(parent);
      } else {
        l.setParentWithJump();
      }
    }
    return layerInfo(l, false);
  }
  if (operation === "addEffect") {
    matches = app.effects;
    j = 0;
    for (i = 0; i < matches.length; i++) {
      if (matches[i].matchName === a.matchName) {
        j++;
      }
    }
    p = l.property("ADBE Effect Parade");
    if (!j || !p || !p.canAddProperty(a.matchName)) {
      operationError(
        "EFFECT_UNAVAILABLE",
        "Installed effect cannot be added to this layer."
      );
    }
    var paradeStep = {
      index: p.propertyIndex,
      matchName: p.matchName,
      name: p.name
    };
    child = p.addProperty(a.matchName);
    if (a.name !== undefined) {
      child.name = a.name;
    }
    return {
      layer: layerInfo(l, false),
      path: [
        paradeStep,
        {
          index: child.propertyIndex,
          matchName: child.matchName,
          name: child.name
        }
      ]
    };
  }
  if (operation === "editEffect" || operation === "removeEffect") {
    p = guardedProperty(l, a.path);
    if (
      a.path.length !== 2 ||
      a.path[0].matchName !== "ADBE Effect Parade" ||
      !p.isEffect
    ) {
      operationError("NOT_EFFECT", "Choose an inspected effect path.");
    }
    if (operation === "removeEffect") {
      p.remove();
      return { removed: a.path, layer: layerInfo(l, false) };
    }
    if (own(a.properties, "enabled") && !p.canSetEnabled) {
      operationError(
        "UNSUPPORTED_PROPERTY",
        "Effect cannot be enabled/disabled."
      );
    }
    if (own(a.properties, "name")) {
      p.name = a.properties.name;
    }
    if (own(a.properties, "enabled")) {
      p.enabled = a.properties.enabled;
    }
    path = a.path.slice(0);
    path[1] = { index: p.propertyIndex, matchName: p.matchName, name: p.name };
    return { layer: layerInfo(l, false), path: path, enabled: p.enabled };
  }
  p = numericProperty(selectedProperty(l, a.target));
  if (operation === "getPropertyInfo") {
    return {
      layer: layerInfo(l, false),
      target: a.target,
      property: numericInfo(p)
    };
  }
  if (operation === "setPropertyValue") {
    requireStatic(p);
    checkNumericValue(p, a.value);
    p.setValue(a.value);
  } else if (operation === "setPropertyKeyframes") {
    requireKeyable(p);
    var newKeys = 0;
    for (i = 0; i < a.keyframes.length; i++) {
      checkNumericValue(p, a.keyframes[i].value);
      if (
        !p.numKeys ||
        Math.abs(
          p.keyTime(p.nearestKeyIndex(a.keyframes[i].time)) -
            a.keyframes[i].time
        ) > 0.000001
      ) {
        newKeys++;
      }
      for (j = 0; j < i; j++) {
        if (Math.abs(a.keyframes[i].time - a.keyframes[j].time) <= 0.000001) {
          operationError("DUPLICATE_TIME", "Keyframe times must be distinct.");
        }
      }
    }
    if (p.numKeys + newKeys > 2000) {
      operationError(
        "INSPECTION_LIMIT",
        "Result would exceed the 2000-key inspection limit."
      );
    }
    for (i = 0; i < a.keyframes.length; i++) {
      p.setValueAtTime(a.keyframes[i].time, a.keyframes[i].value);
    }
  } else if (
    operation === "deletePropertyKeyframes" ||
    operation === "setKeyframeInterpolation"
  ) {
    requireKeyable(p);
    keys = exactKeys(p, a.times);
    if (operation === "deletePropertyKeyframes") {
      keys.sort(function (x, y) {
        return y - x;
      });
      for (i = 0; i < keys.length; i++) {
        p.removeKey(keys[i]);
      }
    } else {
      // Use explicit branches for native enums; nested ternaries produced an
      // incorrect TextDocument alignment in the AE 26.3 acceptance run.
      if (a.interpolation === "linear") {
        interpolation = KeyframeInterpolationType.LINEAR;
      } else if (a.interpolation === "hold") {
        interpolation = KeyframeInterpolationType.HOLD;
      } else {
        interpolation = KeyframeInterpolationType.BEZIER;
      }
      if (!p.isInterpolationTypeValid(interpolation)) {
        operationError(
          "INVALID_INTERPOLATION",
          "Interpolation unsupported by this property."
        );
      }
      if ((a.easeIn || a.easeOut) && a.interpolation !== "bezier") {
        operationError(
          "INVALID_EASE",
          "Custom ease requires bezier interpolation."
        );
      }
      for (i = 0; i < keys.length; i++) {
        if (
          (a.easeIn &&
            a.easeIn.length !== p.keyInTemporalEase(keys[i]).length) ||
          (a.easeOut &&
            a.easeOut.length !== p.keyOutTemporalEase(keys[i]).length)
        ) {
          operationError(
            "DIMENSION_MISMATCH",
            "Ease arrays must match inspected temporalEaseDimensions."
          );
        }
      }
      for (i = 0; i < keys.length; i++) {
        p.setInterpolationTypeAtKey(keys[i], interpolation, interpolation);
        if (a.easeIn || a.easeOut) {
          p.setTemporalAutoBezierAtKey(keys[i], false);
          p.setTemporalContinuousAtKey(keys[i], false);
          if (p.isSpatial) {
            p.setRovingAtKey(keys[i], false);
          }
          easeIn = a.easeIn
            ? makeEases(a.easeIn)
            : p.keyInTemporalEase(keys[i]);
          easeOut = a.easeOut
            ? makeEases(a.easeOut)
            : p.keyOutTemporalEase(keys[i]);
          p.setTemporalEaseAtKey(keys[i], easeIn, easeOut);
        }
      }
    }
  } else if (operation === "setPropertyExpression") {
    if (!p.canSetExpression) {
      operationError(
        "UNSUPPORTED_PROPERTY",
        "Property does not support expressions."
      );
    }
    p.expression = a.expression;
    p.valueAtTime(c.time, false);
    if (p.expressionError) {
      operationError("EXPRESSION_ERROR", p.expressionError);
    }
  } else {
    operationError(
      "UNSUPPORTED_OPERATION",
      "No editing implementation: " + operation
    );
  }
  return {
    layer: layerInfo(l, false),
    target: a.target,
    property: numericInfo(p)
  };
}
