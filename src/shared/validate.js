// ES3 subset, shared verbatim with ExtendScript (build removes export).
export function validate(schema, value, location) {
  var k,
    i,
    valid,
    type = schema.type,
    here = location || "arguments";
  function fail(message) {
    throw new Error(here + ": " + message);
  }
  if (schema.anyOf) {
    valid = false;
    for (i = 0; i < schema.anyOf.length; i++) {
      try {
        validate(schema.anyOf[i], value, here);
        valid = true;
        break;
      } catch (ignored) {}
    }
    if (!valid) {
      fail("does not match an allowed schema");
    }
    return;
  }
  if (type === "object") {
    if (!value || typeof value !== "object" || value instanceof Array) {
      fail("expected object");
    }
    for (i = 0; i < schema.required.length; i++) {
      k = schema.required[i];
      if (!Object.prototype.hasOwnProperty.call(value, k)) {
        fail("missing " + k);
      }
    }
    var count = 0;
    for (k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        count++;
        if (!Object.prototype.hasOwnProperty.call(schema.properties, k)) {
          fail("unknown field " + k);
        }
        validate(schema.properties[k], value[k], here + "." + k);
      }
    }
    if (schema.minProperties && count < schema.minProperties) {
      fail("must not be empty");
    }
  } else if (type === "array") {
    if (!(value instanceof Array)) {
      fail("expected array");
    }
    if (value.length < schema.minItems || value.length > schema.maxItems) {
      fail("incorrect array length");
    }
    for (i = 0; i < value.length; i++) {
      validate(schema.items, value[i], here + "[" + i + "]");
    }
  } else if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !isFinite(value)) {
      fail("expected finite number");
    }
    if (type === "integer" && Math.floor(value) !== value) {
      fail("expected integer");
    }
    if (value < schema.minimum || value > schema.maximum) {
      fail("outside permitted bounds");
    }
  } else if (type === "string") {
    if (typeof value !== "string") {
      fail("expected string");
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail("string too short");
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      fail("string too long");
    }
  } else if (type === "boolean" && typeof value !== "boolean") {
    fail("expected boolean");
  }
  if (schema.enum) {
    valid = false;
    for (i = 0; i < schema.enum.length; i++) {
      if (value === schema.enum[i]) {
        valid = true;
      }
    }
    if (!valid) {
      fail("unsupported value");
    }
  }
}
