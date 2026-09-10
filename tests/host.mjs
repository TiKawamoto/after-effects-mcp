import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { catalog, version, protocolVersion } from "../src/catalog.mjs";
export function host(
  directory,
  app = {
    version: "26.3",
    project: { numItems: 0 },
    beginUndoGroup() {},
    endUndoGroup() {}
  }
) {
  function File(p) {
    if (!(this instanceof File)) return new File(p);
    this.fsName = path.resolve(String(p));
    this.error = "";
  }
  Object.defineProperties(File.prototype, {
    exists: {
      get() {
        return fs.existsSync(this.fsName);
      }
    },
    length: {
      get() {
        return fs.statSync(this.fsName).size;
      }
    },
    name: {
      get() {
        return path.basename(this.fsName);
      }
    },
    parent: {
      get() {
        return new Folder(path.dirname(this.fsName));
      }
    }
  });
  File.prototype.open = function (mode) {
    this.mode = mode;
    if (mode === "w") fs.writeFileSync(this.fsName, "");
    return true;
  };
  File.prototype.read = function () {
    return fs.readFileSync(this.fsName, "utf8");
  };
  File.prototype.write = function (text) {
    fs.writeFileSync(this.fsName, text, "utf8");
    return true;
  };
  File.prototype.close = function () {
    return true;
  };
  File.prototype.remove = function () {
    fs.unlinkSync(this.fsName);
    return true;
  };
  File.prototype.rename = function (name) {
    fs.renameSync(this.fsName, path.join(path.dirname(this.fsName), name));
    this.fsName = path.join(path.dirname(this.fsName), name);
    return true;
  };
  function Folder(p) {
    this.fsName = path.resolve(p);
  }
  Object.defineProperty(Folder.prototype, "exists", {
    get() {
      return fs.existsSync(this.fsName);
    }
  });
  Folder.prototype.create = function () {
    fs.mkdirSync(this.fsName, { recursive: true });
    return true;
  };
  Folder.prototype.getFiles = function (pattern = "*.json") {
    return fs
      .readdirSync(this.fsName)
      .filter((x) => x.endsWith(pattern.slice(1)))
      .map((x) => new File(path.join(this.fsName, x)));
  };
  const context = vm.createContext({
    File,
    Folder,
    app,
    CompItem: class CompItem {},
    console
  });
  const source = [
    "src/bridge/json.jsx",
    "src/shared/validate.js",
    "src/bridge/editing.jsx",
    "src/bridge/operations.jsx",
    "src/bridge/panel.jsx"
  ]
    .map((f) => fs.readFileSync(f, "utf8").replace(/^export /gm, ""))
    .join("\n");
  vm.runInContext(
    `var AE_CATALOG=${JSON.stringify(catalog)},AE_VERSION=${JSON.stringify(version)},AE_PROTOCOL=${protocolVersion};\n` +
      source.split("// PANEL_STARTUP")[0],
    context
  );
  vm.runInContext(
    `root=new Folder(${JSON.stringify(directory)});stopped=false;panelId='panel-test-123456789';`,
    context
  );
  return {
    context,
    run: (code) => vm.runInContext(code, context),
    handle: (filename, server) => context.handle(new File(filename), server)
  };
}
