// Startup, filesystem transport and panel lifecycle. Wrapped by the build in one closure.
var activeRequestId = null;
var panelId =
  "panel-" +
  String(new Date().getTime()) +
  "-" +
  String(Math.floor(Math.random() * 1000000000));
var root,
  ui,
  statusText,
  taskId = null,
  stopped = true,
  retired = false,
  busy = false;
function fileAt(folder, name) {
  return new File(root.fsName + "/" + (folder ? folder + "/" : "") + name);
}
function readFile(file) {
  if (!file.exists) {
    return null;
  }
  if (file.length > 1048576) {
    throw new Error("Message exceeds 1 MiB");
  }
  file.encoding = "UTF-8";
  if (!file.open("r")) {
    throw new Error("Cannot read " + file.fsName + ": " + file.error);
  }
  var text;
  try {
    text = file.read();
  } finally {
    file.close();
  }
  return StrictJSON.parse(text.replace(/^\uFEFF/, ""));
}
function optionalRead(file) {
  try {
    return readFile(file);
  } catch (ignored) {
    return null;
  }
}
function absoluteBridgePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  // ExtendScript's lexer rejects an unescaped slash inside a regex character
  // class even though standards-compliant ES3 parsers accept it.
  return value.charAt(0) === "/" ||
    (value.length >= 3 && /^[A-Za-z]$/.test(value.charAt(0)) &&
      value.charAt(1) === ":" &&
      (value.charAt(2) === "/" || value.charAt(2) === "\\"));
}
function publish(file, value, replace) {
  var text = StrictJSON.stringify(value),
    temp = new File(file.fsName + "." + panelId + ".tmp"),
    name = file.name;
  if (text.length > 500000) {
    throw new Error("Response too large; inspect a smaller target.");
  }
  if (file.exists && !replace) {
    return;
  }
  temp.encoding = "UTF-8";
  if (!temp.open("w")) {
    throw new Error("Cannot write " + temp.fsName + ": " + temp.error);
  }
  var written = temp.write(text),
    closed = temp.close();
  if (!written || !closed) {
    throw new Error("Could not finish writing " + temp.fsName);
  }
  // Immutable request/result files use same-directory rename. Heartbeats tolerate a brief missing file.
  if (replace && file.exists && !file.remove()) {
    throw new Error("Cannot replace " + file.fsName);
  }
  if (!temp.rename(name)) {
    throw new Error("Atomic publish failed: " + temp.error);
  }
}
function log(message) {
  if (statusText) {
    statusText.text = String(message).substr(0, 500);
  }
}
function hello() {
  publish(
    fileAt("panels", panelId + ".hello.json"),
    {
      panelId: panelId,
      protocolVersion: AE_PROTOCOL,
      bridgeVersion: AE_VERSION,
      aeVersion: app.version,
      updatedAt: new Date().getTime()
    },
    true
  );
}
function responseFor(r, status, data, error) {
  var out = {
    protocolVersion: AE_PROTOCOL,
    requestId: r.requestId,
    operation: r.operation,
    serverId: r.serverId,
    panelId: panelId,
    status: status,
    completedAt: new Date().getTime()
  };
  if (data !== undefined) {
    out.data = data;
  }
  if (error) {
    out.error = error;
  }
  return out;
}
function handle(file, server) {
  var name = file.name,
    id = name.substr(0, name.length - 5),
    r,
    finalFile = fileAt("results", name),
    startFile = fileAt("started", name),
    out,
    spec;
  if (finalFile.exists) {
    return;
  }
  r = { requestId: id, operation: "unknown", serverId: server.serverId };
  try {
    var parsed = readFile(file),
      now = new Date().getTime(),
      key;
    if (!parsed || parsed instanceof Array || typeof parsed !== "object") {
      operationError("INVALID_ENVELOPE", "Expected request object.");
    }
    r = parsed;
    if (
      r.requestId !== id ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      typeof r.operation !== "string"
    ) {
      operationError(
        "INVALID_ENVELOPE",
        "Filename and UUID must match; operation must be a string."
      );
    }
    var allowed = {
      protocolVersion: 1,
      serverVersion: 1,
      serverId: 1,
      panelId: 1,
      requestId: 1,
      operation: 1,
      arguments: 1,
      createdAt: 1,
      expiresAt: 1
    };
    for (key in r) {
      if (
        Object.prototype.hasOwnProperty.call(r, key) &&
        !Object.prototype.hasOwnProperty.call(allowed, key)
      ) {
        operationError("INVALID_ENVELOPE", "Unknown envelope field.");
      }
    }
    if (startFile.exists) {
      out = responseFor(r, "outcome_unknown", undefined, {
        code: "INTERRUPTED_REQUEST",
        message:
          "A started journal exists without a final result. The edit may have occurred; inspect AE before retrying.",
        mayHaveChanged: true
      });
    } else {
      if (r.protocolVersion !== AE_PROTOCOL || r.serverVersion !== AE_VERSION) {
        operationError("VERSION_MISMATCH", "Update both server and panel.");
      }
      if (r.serverId !== server.serverId || r.panelId !== panelId) {
        operationError(
          "STALE_SESSION",
          "Request belongs to another server or panel session; it was not replayed."
        );
      }
      if (
        typeof r.createdAt !== "number" ||
        typeof r.expiresAt !== "number" ||
        !isFinite(r.createdAt) ||
        !isFinite(r.expiresAt) ||
        r.createdAt > now + 1000 ||
        r.expiresAt <= now ||
        r.expiresAt - r.createdAt > 60000 ||
        r.expiresAt <= r.createdAt
      ) {
        operationError(
          "EXPIRED_REQUEST",
          "Expired or invalid request timing; not executed."
        );
      }
      spec = findSpec(r.operation);
      validate(spec.inputSchema, r.arguments, "arguments");
      // Durable intent BEFORE any AE mutation. No replay after this point, even after a crash.
      publish(
        startFile,
        {
          requestId: id,
          operation: r.operation,
          serverId: r.serverId,
          panelId: panelId,
          startedAt: now
        },
        false
      );
      var current = optionalRead(fileAt("", "server.json")),
        owner = optionalRead(fileAt("", "owner.json"));
      if (
        !current ||
        current.serverId !== r.serverId ||
        !owner ||
        owner.panelId !== panelId ||
        stopped
      ) {
        operationError(
          "DISCONNECTED",
          "Ownership or server session changed before execution."
        );
      }
      activeRequestId = id;
      try { out = responseFor(r, "success", dispatch(r.operation, r.arguments)); }
      finally { activeRequestId = null; }
    }
  } catch (e) {
    // Persist under the safe filename even when untrusted envelope identifiers are malformed.
    r.requestId = id;
    out = responseFor(r, "error", e.data, {
      code: e.code || "INVALID_OR_FAILED_REQUEST",
      message: String(e),
      mayHaveChanged:
        startFile.exists && (!spec || !spec.annotations.readOnlyHint)
    });
  }
  publish(finalFile, out, false);
  log(out.status + ": " + out.operation + " / " + id);
}
function tick() {
  taskId = null;
  if (stopped || busy) {
    return;
  }
  busy = true;
  try {
    hello();
    var server = optionalRead(fileAt("", "server.json")),
      owner = optionalRead(fileAt("", "owner.json")),
      now = new Date().getTime();
    if (!server || Math.abs(now - server.updatedAt) > 5000) {
      log("Waiting for Node MCP server: " + root.fsName);
    } else if (
      server.protocolVersion !== AE_PROTOCOL ||
      server.serverVersion !== AE_VERSION
    ) {
      log("Version mismatch. Rebuild/reinstall both server and panel.");
    } else if (!owner || owner.panelId !== panelId) {
      log(
        "Waiting for exclusive ownership. Stop the other panel; do not run two AE instances."
      );
    } else {
      var files = new Folder(root.fsName + "/requests").getFiles("*.json"),
        candidates = [],
        i,
        f,
        r;
      for (i = 0; i < files.length; i++) {
        f = files[i];
        if (
          f instanceof File &&
          /^[a-f0-9-]{36}\.json$/.test(f.name) &&
          !fileAt("results", f.name).exists
        ) {
          r = optionalRead(f);
          candidates.push({
            file: f,
            createdAt: r && typeof r.createdAt === "number" ? r.createdAt : 0
          });
          if (candidates.length >= 32) {
            break;
          }
        }
      }
      candidates.sort(function (a, b) {
        return a.createdAt - b.createdAt;
      });
      if (candidates.length) {
        handle(candidates[0].file, server);
      } else {
        log(
          "Connected • AE " +
            app.version +
            " • Bridge " +
            AE_VERSION +
            " • " +
            root.fsName
        );
      }
    }
  } catch (e) {
    log(
      "Bridge error: " +
        e +
        " — Check directory and Allow Scripts to Write Files and Access Network."
    );
  } finally {
    busy = false;
    if (!stopped) {
      taskId = app.scheduleTask("$.global.__AE_MCP.tick()", 500, false);
    }
  }
}
function stop() {
  stopped = true;
  if (taskId !== null) {
    try {
      app.cancelTask(taskId);
    } catch (ignored) {}
    taskId = null;
  }
  if (root) {
    try {
      publish(
        fileAt("panels", panelId + ".released.json"),
        { panelId: panelId, releasedAt: new Date().getTime() },
        false
      );
    } catch (ignored2) {}
  }
  log("Stopped. Click Start to reconnect.");
}
function start() {
  if (retired) {
    log("This panel was replaced. Use the most recently opened MCP panel.");
    return;
  }
  if (!stopped) {
    return;
  }
  // Every restart gets a new identity; never revive an already released owner.
  panelId =
    "panel-" +
    String(new Date().getTime()) +
    "-" +
    String(Math.floor(Math.random() * 1000000000));
  projectSession = "";
  stopped = false;
  tick();
}
function dispose() {
  stop();
  retired = true;
  // An old Start callback must never publish a new identity after the global
  // scheduled callback has been replaced by a newer panel instance.
  if (ui) {
    if (ui instanceof Window) {
      ui.close();
    } else if (buttons) {
      buttons.enabled = false;
    }
  }
}
// PANEL_STARTUP
try {
  if ($.global.__AE_MCP) {
    if ($.global.__AE_MCP.dispose) {
      $.global.__AE_MCP.dispose();
    } else {
      $.global.__AE_MCP.stop();
    }
  }
  var configuration = new File(
    new File($.fileName).parent.fsName + "/mcp-bridge.config.json"
  );
  var settings = readFile(configuration);
  if (
    !settings ||
    !absoluteBridgePath(settings.bridgeDirectory)
  ) {
    throw new Error(
      "Missing absolute bridgeDirectory in " +
        configuration.fsName +
        ". Run installer or place config next to panel."
    );
  }
  root = new Folder(settings.bridgeDirectory);
  if (!root.exists && !root.create()) {
    throw new Error("Cannot create bridge directory " + root.fsName);
  }
  var folders = ["requests", "results", "started", "panels"],
    fi;
  for (fi = 0; fi < folders.length; fi++) {
    var sub = new Folder(root.fsName + "/" + folders[fi]);
    if (!sub.exists && !sub.create()) {
      throw new Error("Cannot create " + sub.fsName);
    }
  }
  if (parseFloat(app.version) < 22) {
    throw new Error("AE 22 or newer is required for stable layer IDs.");
  }
  ui =
    thisObj instanceof Panel
      ? thisObj
      : new Window("palette", "After Effects MCP " + AE_VERSION, undefined, {
          resizeable: true
        });
  ui.orientation = "column";
  ui.alignChildren = ["fill", "top"];
  ui.add(
    "statictext",
    undefined,
    "Protocol " + AE_PROTOCOL + " | AE " + app.version
  );
  ui.add("edittext", undefined, root.fsName, { readonly: true });
  statusText = ui.add("statictext", undefined, "Starting…", {
    multiline: true
  });
  statusText.preferredSize = [500, 65];
  var buttons = ui.add("group");
  buttons.add("button", undefined, "Start").onClick = start;
  buttons.add("button", undefined, "Stop").onClick = stop;
  ui.onClose = stop;
  ui.onResizing = ui.onResize = function () {
    this.layout.resize();
  };
  $.global.__AE_MCP = { tick: tick, stop: stop, start: start, dispose: dispose };
  if (ui instanceof Window) {
    ui.center();
    ui.show();
  } else {
    ui.layout.layout(true);
  }
  start();
} catch (startupError) {
  alert("AE MCP setup failed: " + startupError);
}
