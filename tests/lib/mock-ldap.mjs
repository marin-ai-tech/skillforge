// Test LDAP server. Minimal BER/LDAPv3: BindRequest (simple),
// SearchRequest (filters and/or/not/equality/present/substrings), UnbindRequest; ExtendedRequest (StartTLS) is rejected.
// Independent of SkillForge code and LDAP libraries. Like many real servers, it accepts an "unauthenticated bind"
// (DN + empty password) — the client must forbid an empty password itself. Received filters are recorded as a string
// (RFC 4515, with escaping) to check protection against LDAP injection.
import { createServer } from "node:net";

// ---------- BER ----------
function readLength(buf, pos) {
  const first = buf[pos];
  if (first === undefined) return null;
  if (first < 0x80) return { len: first, next: pos + 1 };
  const n = first & 0x7f;
  if (n === 0 || n > 4 || pos + 1 + n > buf.length) return null;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + buf[pos + 1 + i];
  return { len, next: pos + 1 + n };
}

/** Parses one TLV starting at pos; null if there is not enough data yet. */
function readTlv(buf, pos) {
  if (pos >= buf.length) return null;
  const tag = buf[pos];
  const l = readLength(buf, pos + 1);
  if (!l || l.next + l.len > buf.length) return null;
  return { tag, value: buf.subarray(l.next, l.next + l.len), end: l.next + l.len };
}

function children(value) {
  const out = [];
  let pos = 0;
  while (pos < value.length) {
    const t = readTlv(value, pos);
    if (!t) throw new Error("bad BER");
    out.push(t);
    pos = t.end;
  }
  return out;
}

const readInt = (v) => {
  let n = 0;
  for (const b of v) n = n * 256 + b;
  if (v.length && v[0] & 0x80) n -= 2 ** (8 * v.length);
  return n;
};
const str = (v) => Buffer.from(v).toString("utf8");

function encLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  while (len > 0) {
    bytes.unshift(len & 0xff);
    len >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, value) => Buffer.concat([Buffer.from([tag]), encLength(value.length), value]);
const encInt = (tag, n) => {
  const bytes = [];
  do {
    bytes.unshift(n & 0xff);
    n >>= 8;
  } while (n > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(tag, Buffer.from(bytes));
};
const octets = (s) => tlv(0x04, Buffer.from(s, "utf8"));
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));

function ldapResult(appTag, code, diag = "") {
  return tlv(appTag, Buffer.concat([encInt(0x0a, code), octets(""), octets(diag)]));
}
const message = (id, op) => seq(encInt(0x02, id), op);

// ---------- filters ----------
const escapeValue = (v) =>
  v.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));

/** Turns a BER filter into { str, test(entry) }. */
function parseFilter(t) {
  const ctx = t.tag;
  if (ctx === 0xa0 || ctx === 0xa1) {
    const subs = children(t.value).map(parseFilter);
    const op = ctx === 0xa0 ? "&" : "|";
    return {
      str: `(${op}${subs.map((s) => s.str).join("")})`,
      test: (e) => (ctx === 0xa0 ? subs.every((s) => s.test(e)) : subs.some((s) => s.test(e))),
    };
  }
  if (ctx === 0xa2) {
    const inner = parseFilter(children(t.value)[0]);
    return { str: `(!${inner.str})`, test: (e) => !inner.test(e) };
  }
  if (ctx === 0xa3) {
    const [a, v] = children(t.value);
    const attr = str(a.value).toLowerCase();
    const val = str(v.value);
    return {
      str: `(${str(a.value)}=${escapeValue(val)})`,
      test: (e) => (e.attrs[attr] ?? []).some((x) => x.toLowerCase() === val.toLowerCase()),
    };
  }
  if (ctx === 0x87) {
    const attr = str(t.value).toLowerCase();
    return { str: `(${str(t.value)}=*)`, test: (e) => (e.attrs[attr] ?? []).length > 0 || attr === "objectclass" };
  }
  if (ctx === 0xa4) {
    const [a, parts] = children(t.value);
    const attr = str(a.value).toLowerCase();
    const segs = children(parts.value).map((p) => ({ kind: p.tag & 0x0f, val: str(p.value) }));
    const shown = segs.map((s) => (s.kind === 0 ? `${escapeValue(s.val)}*` : s.kind === 2 ? `*${escapeValue(s.val)}` : `*${escapeValue(s.val)}*`)).join("");
    return {
      str: `(${str(a.value)}=${shown})`,
      test: (e) =>
        (e.attrs[attr] ?? []).some((x) => {
          let rest = x.toLowerCase();
          for (const s of segs) {
            const v = s.val.toLowerCase();
            if (s.kind === 0) {
              if (!rest.startsWith(v)) return false;
              rest = rest.slice(v.length);
            } else if (s.kind === 2) {
              if (!rest.endsWith(v)) return false;
            } else {
              const i = rest.indexOf(v);
              if (i < 0) return false;
              rest = rest.slice(i + v.length);
            }
          }
          return true;
        }),
    };
  }
  return { str: `(?${ctx.toString(16)})`, test: () => false };
}

// ---------- server ----------
/**
 * Starts an LDAP server on 127.0.0.1:<free port>.
 * directory: [{ dn, password?, attrs: { uid: [...], cn: [...], mail: [...], memberOf: [...] } }] (attribute names are arbitrary,
 * case-insensitive comparison). Returns { url, filters, binds, stop }.
 */
export async function startMockLdap(directory) {
  const entries = directory.map((e) => ({
    dn: e.dn,
    password: e.password,
    attrs: Object.fromEntries(Object.entries(e.attrs).map(([k, v]) => [k.toLowerCase(), v])),
    rawAttrs: e.attrs,
  }));
  const log = { filters: [], binds: [] };
  const sockets = new Set();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let boundDn = null;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const msg = readTlv(buf, 0);
        if (!msg) break;
        buf = buf.subarray(msg.end);
        let parts;
        try {
          parts = children(msg.value);
        } catch {
          socket.destroy();
          return;
        }
        const id = readInt(parts[0].value);
        const op = parts[1];
        if (op.tag === 0x60) {
          const [, name, auth] = children(op.value);
          const dn = str(name.value);
          const pw = auth.tag === 0x80 ? str(auth.value) : null;
          log.binds.push({ dn, empty: pw === "" });
          let code = 49;
          if (pw === "") code = 0; // unauthenticated bind — "success", like many servers
          else {
            const e = entries.find((x) => x.dn.toLowerCase() === dn.toLowerCase());
            if (e && e.password !== undefined && e.password === pw) code = 0;
          }
          boundDn = code === 0 ? dn : null;
          socket.write(message(id, ldapResult(0x61, code, code === 0 ? "" : "Invalid credentials")));
        } else if (op.tag === 0x63) {
          const [baseObj, scope, , sizeLimitTlv, , , filterTlv, attrsTlv] = children(op.value);
          const sizeLimit = readInt(sizeLimitTlv.value);
          const base = str(baseObj.value).toLowerCase();
          const f = parseFilter(filterTlv);
          log.filters.push(f.str);
          const wanted = children(attrsTlv.value).map((a) => str(a.value).toLowerCase());
          const sc = readInt(scope.value);
          if (boundDn === null) {
            socket.write(message(id, ldapResult(0x65, 50, "Insufficient access")));
            continue;
          }
          let sent = 0;
          let exceeded = false;
          for (const e of entries) {
            const dn = e.dn.toLowerCase();
            const inScope = sc === 0 ? dn === base : dn === base || dn.endsWith("," + base);
            if (!inScope || !f.test(e)) continue;
            // Like a real server: when sizeLimit is exceeded, the result is sizeLimitExceeded (4).
            if (sizeLimit > 0 && sent >= sizeLimit) {
              exceeded = true;
              break;
            }
            sent++;
            const attrParts = Object.entries(e.rawAttrs)
              .filter(([k]) => wanted.length === 0 || wanted.includes(k.toLowerCase()) || wanted.includes("*"))
              .map(([k, vals]) => seq(octets(k), set(...vals.map(octets))));
            socket.write(message(id, tlv(0x64, Buffer.concat([octets(e.dn), seq(...attrParts)]))));
          }
          socket.write(message(id, exceeded ? ldapResult(0x65, 4, "Size limit exceeded") : ldapResult(0x65, 0)));
        } else if (op.tag === 0x42) {
          socket.end();
        } else if (op.tag === 0x77) {
          socket.write(message(id, tlv(0x78, Buffer.concat([encInt(0x0a, 2), octets(""), octets("StartTLS not supported")]))));
        } else {
          socket.write(message(id, ldapResult(0x61, 2, "Unsupported operation")));
        }
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `ldap://127.0.0.1:${server.address().port}`,
    filters: log.filters,
    binds: log.binds,
    stop: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
