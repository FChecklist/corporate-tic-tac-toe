// A small JSON-schema checker with no outside packages (the contract fixtures are checked with it, on the console and later inside each game's tests).
// Supported words: type (string|number|integer|boolean|object|array|null, or a list), enum, const, required, properties, additionalProperties (false | schema),
// items, minItems, maxItems, minLength, maxLength, pattern, minimum, maximum, oneOf, anyOf, $ref to "#/$defs/name" (same file only).
// Strict by design: an object schema without 'additionalProperties' is treated as closed (false) so that an undocumented field is always an error.
// check(schema, value) returns a list of problems like "$.rows[2].amount: expected number"; an empty list means valid.
export function check(schema, value, path = "$", root = schema) {
  const out = [];
  const s = resolve(schema, root);
  if (!s || s === true) return out;
  if (s.oneOf) {
    const ok = s.oneOf.filter((alt) => check(alt, value, path, root).length === 0).length;
    if (ok !== 1) out.push(`${path}: must match exactly one of the allowed shapes (matches ${ok})`);
    return out;
  }
  if (s.anyOf) {
    if (!s.anyOf.some((alt) => check(alt, value, path, root).length === 0)) out.push(`${path}: matches none of the allowed shapes`);
    return out;
  }
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(value)) out.push(`${path}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) out.push(`${path}: must be one of ${JSON.stringify(s.enum)}`);
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => isType(t, value))) { out.push(`${path}: expected ${types.join(" or ")}`); return out; }
  }
  if (typeof value === "string") {
    if (s.minLength != null && value.length < s.minLength) out.push(`${path}: shorter than ${s.minLength}`);
    if (s.maxLength != null && value.length > s.maxLength) out.push(`${path}: longer than ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(value)) out.push(`${path}: does not match ${s.pattern}`);
  }
  if (typeof value === "number") {
    if (s.minimum != null && value < s.minimum) out.push(`${path}: below ${s.minimum}`);
    if (s.maximum != null && value > s.maximum) out.push(`${path}: above ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems != null && value.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems != null && value.length > s.maxItems) out.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) value.forEach((v, i) => out.push(...check(s.items, v, `${path}[${i}]`, root)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const props = s.properties || {};
    for (const r of s.required || []) if (!(r in value)) out.push(`${path}.${r}: missing`);
    for (const k of Object.keys(value)) {
      if (k in props) out.push(...check(props[k], value[k], `${path}.${k}`, root));
      else if (s.additionalProperties && s.additionalProperties !== true) out.push(...check(s.additionalProperties, value[k], `${path}.${k}`, root));
      else if (s.additionalProperties !== true && (s.additionalProperties === false || s.type === "object" || s.properties)) out.push(`${path}.${k}: not in the contract`);
    }
  }
  return out;
}
function resolve(s, root) {
  if (s && typeof s === "object" && s.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    if (!m || !root.$defs || !root.$defs[m[1]]) throw new Error("bad $ref " + s.$ref);
    return root.$defs[m[1]];
  }
  return s;
}
function isType(t, v) {
  switch (t) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    case "array": return Array.isArray(v);
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    default: return false;
  }
}
