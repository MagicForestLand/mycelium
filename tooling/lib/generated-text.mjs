// These values are inserted into JSON without runtime escaping.
export function assertJSONSafeASCII(value, field) {
  if (typeof value !== 'string' || !value.length || !/^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/.test(value)) {
    throw new Error(`${field}: require nonempty JSON-safe ASCII without quotes, backslashes or controls`);
  }
  return value;
}

export function assertProjectURL(value) {
  assertJSONSafeASCII(value, 'PROJECT_URL');
  // URL() normalizes malformed input; reject unsafe raw bytes before parsing.
  if (/\s/.test(value) || /%(?![0-9a-f]{2})/i.test(value) || !/^https?:\/\//.test(value)) {
    throw new Error('PROJECT_URL: require an absolute HTTP(S) URL without whitespace or malformed escapes');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('PROJECT_URL: invalid URL'); }
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error('PROJECT_URL: host required; credentials are not allowed');
  return value;
}

export function jsonStringContent(value, field) {
  if (typeof value !== 'string') throw new Error(`${field}: require a string`);
  return JSON.stringify(value).slice(1, -1);
}
