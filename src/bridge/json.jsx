// Strict recursive-descent JSON, no eval/Function or host JSON dependency.
var StrictJSON = (function () {
  function parse(text) {
    var at = 0;
    function error() {
      throw new Error("Invalid JSON at character " + at);
    }
    function space() {
      while (at < text.length && /[\x20\t\r\n]/.test(text.charAt(at))) {
        at++;
      }
    }
    function str() {
      var out = "",
        c,
        hex,
        escapes = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t"
        };
      at++;
      while (at < text.length) {
        c = text.charAt(at++);
        if (c === '"') {
          return out;
        }
        if (c === "\\") {
          c = text.charAt(at++);
          if (c === "u") {
            hex = text.substr(at, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              error();
            }
            out += String.fromCharCode(parseInt(hex, 16));
            at += 4;
          } else if (Object.prototype.hasOwnProperty.call(escapes, c)) {
            out += escapes[c];
          } else {
            error();
          }
        } else {
          if (c.charCodeAt(0) < 32) {
            error();
          }
          out += c;
        }
      }
      error();
    }
    function val(depth) {
      if (depth > 64) {
        error();
      }
      space();
      var c = text.charAt(at),
        out,
        key,
        match,
        n;
      if (c === '"') {
        return str();
      }
      if (c === "{") {
        out = {};
        at++;
        space();
        if (text.charAt(at) === "}") {
          at++;
          return out;
        }
        while (true) {
          space();
          if (text.charAt(at) !== '"') {
            error();
          }
          key = str();
          if (
            key === "__proto__" ||
            key === "constructor" ||
            key === "prototype" ||
            Object.prototype.hasOwnProperty.call(out, key)
          ) {
            error();
          }
          space();
          if (text.charAt(at++) !== ":") {
            error();
          }
          out[key] = val(depth + 1);
          space();
          c = text.charAt(at++);
          if (c === "}") {
            return out;
          }
          if (c !== ",") {
            error();
          }
        }
      }
      if (c === "[") {
        out = [];
        at++;
        space();
        if (text.charAt(at) === "]") {
          at++;
          return out;
        }
        while (true) {
          out.push(val(depth + 1));
          space();
          c = text.charAt(at++);
          if (c === "]") {
            return out;
          }
          if (c !== ",") {
            error();
          }
        }
      }
      match = /^(true|false|null)/.exec(text.substr(at));
      if (match) {
        at += match[0].length;
        return match[0] === "null" ? null : match[0] === "true";
      }
      match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(
        text.substr(at)
      );
      if (!match) {
        error();
      }
      at += match[0].length;
      n = Number(match[0]);
      if (!isFinite(n)) {
        error();
      }
      return n;
    }
    if (typeof text !== "string") {
      error();
    }
    var result = val(0);
    space();
    if (at !== text.length) {
      error();
    }
    return result;
  }
  function quote(s) {
    return (
      '"' +
      s.replace(/["\\\x00-\x1f\u2028\u2029]/g, function (c) {
        var h = c.charCodeAt(0).toString(16);
        return "\\u" + ("0000" + h).slice(-4);
      }) +
      '"'
    );
  }
  function stringify(v) {
    var out = [],
      i,
      k;
    if (v === null) {
      return "null";
    }
    if (typeof v === "string") {
      return quote(v);
    }
    if (typeof v === "number") {
      if (!isFinite(v)) {
        throw new Error("Nonfinite JSON number");
      }
      return String(v);
    }
    if (typeof v === "boolean") {
      return String(v);
    }
    if (v instanceof Array) {
      for (i = 0; i < v.length; i++) {
        out.push(stringify(v[i]));
      }
      return "[" + out.join(",") + "]";
    }
    if (typeof v === "object") {
      for (k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k) && v[k] !== undefined) {
          out.push(quote(k) + ":" + stringify(v[k]));
        }
      }
      return "{" + out.join(",") + "}";
    }
    throw new Error("Unsupported JSON value");
  }
  return { parse: parse, stringify: stringify };
})();
