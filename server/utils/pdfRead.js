/**
 * Reading a bank statement from a PDF, with Node's own modules and no libraries.
 *
 *   openPdf(buffer, password)  -> a document: { pages: [{ width, height, items: [{ x, y, x2, size, text }] }] }
 *
 * What it does: finds the objects of the file (a straight scan, so a damaged cross-reference table does not matter), opens the password
 * (the Standard security handler: RC4 40/128-bit, AES-128 and AES-256 revision 5/6; an empty user password is tried first), unpacks the
 * streams (Flate, ASCII85, ASCIIHex, with PNG/TIFF predictors), walks the page tree, reads each page's content stream and gives back every
 * piece of text with where it sits on the page. Fonts are decoded with their /ToUnicode map, or with their simple encoding.
 * What it does not do: scanned pages (no text), LZW, rotated pages, passwords for the owner only.
 * Specification: ISO 32000-1 (PDF 1.7) and ISO 32000-2 (PDF 2.0) for AES-256 revision 6.
 * Errors carry .code: "not_pdf", "password_required", "wrong_password", "unsupported", "no_text", "corrupt".
 */
const zlib = require("zlib");
const crypto = require("crypto");

const fail = (code, message) => Object.assign(new Error(message), { code, status: 400 });

/* ───────── parsing the objects ───────── */

class Str { constructor(buf) { this.buf = buf; } }
class Name { constructor(name) { this.name = name; } }
class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
class Kw { constructor(kw) { this.kw = kw; } }

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);   // ( ) < > [ ] { } / %

class Parser {
    constructor(buf, pos = 0) { this.b = buf; this.i = pos; }
    skip() {
        const b = this.b;
        while (this.i < b.length) {
            const c = b[this.i];
            if (WS.has(c)) this.i++;
            else if (c === 37) { while (this.i < b.length && b[this.i] !== 10 && b[this.i] !== 13) this.i++; }
            else break;
        }
    }
    eof() { this.skip(); return this.i >= this.b.length; }
    token() {                                      // a run of regular characters
        const b = this.b, s = this.i;
        while (this.i < b.length && !WS.has(b[this.i]) && !DELIM.has(b[this.i])) this.i++;
        return b.toString("latin1", s, this.i);
    }
    value() {
        this.skip();
        const b = this.b, c = b[this.i];
        if (c === undefined) return null;
        if (c === 47) { this.i++; return new Name(this.token().replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))); }
        if (c === 40) return this.literal();
        if (c === 60 && b[this.i + 1] === 60) { this.i += 2; return this.dict(); }
        if (c === 60) return this.hex();
        if (c === 91) { this.i++; const out = []; for (;;) { this.skip(); if (this.i >= b.length) break; if (b[this.i] === 93) { this.i++; break; } out.push(this.value()); } return out; }
        if (c === 62 && b[this.i + 1] === 62) { this.i += 2; return new Kw(">>"); }
        if (c === 93 || c === 41 || c === 62 || c === 123 || c === 125) { this.i++; return new Kw(String.fromCharCode(c)); }
        const t = this.token();
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) {
            const n = Number(t);
            if (/^\d+$/.test(t)) {                 // "12 0 R"
                const save = this.i;
                this.skip();
                const g = this.token();
                if (/^\d+$/.test(g)) { this.skip(); if (b[this.i] === 82 && (WS.has(b[this.i + 1]) || DELIM.has(b[this.i + 1]) || b[this.i + 1] === undefined)) { this.i++; return new Ref(n, Number(g)); } }
                this.i = save;
            }
            return n;
        }
        if (t === "true") return true;
        if (t === "false") return false;
        if (t === "null") return null;
        if (t === "") { this.i++; return new Kw("?"); }
        return new Kw(t);
    }
    dict() {
        const d = {};
        for (;;) {
            this.skip();
            if (this.i >= this.b.length) break;
            if (this.b[this.i] === 62 && this.b[this.i + 1] === 62) { this.i += 2; break; }
            const k = this.value();
            if (!(k instanceof Name)) { if (k instanceof Kw && k.kw === ">>") break; continue; }
            d[k.name] = this.value();
        }
        return d;
    }
    literal() {
        const b = this.b, out = [];
        let depth = 0;
        this.i++;
        while (this.i < b.length) {
            const c = b[this.i++];
            if (c === 92) {
                const e = b[this.i++];
                if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9); else if (e === 98) out.push(8); else if (e === 102) out.push(12);
                else if (e >= 48 && e <= 55) {
                    let v = e - 48, n = 1;
                    while (n < 3 && b[this.i] >= 48 && b[this.i] <= 55) { v = v * 8 + b[this.i++] - 48; n++; }
                    out.push(v & 255);
                } else if (e === 13) { if (b[this.i] === 10) this.i++; } else if (e === 10) { /* line continuation */ } else out.push(e);
            } else if (c === 40) { depth++; out.push(c); }
            else if (c === 41) { if (depth === 0) break; depth--; out.push(c); }
            else out.push(c);
        }
        return new Str(Buffer.from(out));
    }
    hex() {
        const b = this.b;
        this.i++;
        let h = "";
        while (this.i < b.length && b[this.i] !== 62) { const c = String.fromCharCode(b[this.i++]); if (/[0-9a-fA-F]/.test(c)) h += c; }
        this.i++;
        if (h.length % 2) h += "0";
        return new Str(Buffer.from(h, "hex"));
    }
}

/* ───────── streams ───────── */

function pngPredict(data, columns, colors, bpc) {
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8)), row = Math.ceil((columns * colors * bpc) / 8);
    const out = Buffer.alloc(Math.floor(data.length / (row + 1)) * row);
    let prev = Buffer.alloc(row);
    for (let r = 0, o = 0; (r + 1) * (row + 1) <= data.length; r++, o += row) {
        const t = data[r * (row + 1)], cur = Buffer.from(data.subarray(r * (row + 1) + 1, (r + 1) * (row + 1)));
        for (let i = 0; i < row; i++) {
            const left = i >= bpp ? cur[i - bpp] : 0, up = prev[i], ul = i >= bpp ? prev[i - bpp] : 0;
            if (t === 1) cur[i] = (cur[i] + left) & 255;
            else if (t === 2) cur[i] = (cur[i] + up) & 255;
            else if (t === 3) cur[i] = (cur[i] + ((left + up) >> 1)) & 255;
            else if (t === 4) { const p = left + up - ul, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul); cur[i] = (cur[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 255; }
        }
        cur.copy(out, o); prev = cur;
    }
    return out;
}

function ascii85(data) {
    const s = data.toString("latin1").replace(/\s+/g, "").replace(/^<~/, "").replace(/~>.*$/, "");
    const out = [];
    let group = [];
    for (const ch of s) {
        if (ch === "z" && group.length === 0) { out.push(0, 0, 0, 0); continue; }
        group.push(ch.charCodeAt(0) - 33);
        if (group.length === 5) { let v = 0; for (const g of group) v = v * 85 + g; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); group = []; }
    }
    if (group.length > 1) {
        const n = group.length;
        while (group.length < 5) group.push(84);
        let v = 0; for (const g of group) v = v * 85 + g;
        const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
        out.push(...bytes.slice(0, n - 1));
    }
    return Buffer.from(out);
}

function inflate(data) {
    try { return zlib.inflateSync(data); }
    catch (e) {
        try { return zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }          // a stream cut short or with a bad checksum
        catch (e2) { try { return zlib.inflateRawSync(data.subarray(2), { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch (e3) { throw fail("corrupt", "A part of the PDF could not be unpacked."); } }
    }
}

/* ───────── passwords and decryption ───────── */

const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = (...p) => crypto.createHash("md5").update(Buffer.concat(p)).digest();
const sha = (algo, ...p) => crypto.createHash(algo).update(Buffer.concat(p)).digest();

function rc4(key, data) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    const out = Buffer.alloc(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
    return out;
}

function aesCbc(key, iv, data, decrypt, padding) {
    const c = (decrypt ? crypto.createDecipheriv : crypto.createCipheriv)(`aes-${key.length * 8}-cbc`, key, iv);
    c.setAutoPadding(padding);
    return Buffer.concat([c.update(data), c.final()]);
}

/** AES with the 16-byte IV in front and PKCS#7 padding at the end (how PDF stores an encrypted stream). */
function aesStream(key, data) {
    if (data.length < 32) return Buffer.alloc(0);
    const body = data.subarray(16, 16 + Math.floor((data.length - 16) / 16) * 16);
    const plain = aesCbc(key, data.subarray(0, 16), body, true, false);
    const pad = plain[plain.length - 1];
    return pad >= 1 && pad <= 16 ? plain.subarray(0, plain.length - pad) : plain;
}

/** Algorithm 2.B of ISO 32000-2: the revision 6 password hash. */
function hash2B(password, salt, udata) {
    let k = sha("sha256", password, salt, udata);
    for (let i = 0; ; i++) {
        const k1 = Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([password, k, udata])));
        const e = aesCbc(k.subarray(0, 16), k.subarray(16, 32), k1, false, false);
        let sum = 0; for (let j = 0; j < 16; j++) sum += e[j];
        k = sha(["sha256", "sha384", "sha512"][sum % 3], e);
        if (i >= 63 && e[e.length - 1] <= i - 31) break;
    }
    return k.subarray(0, 32);
}

/**
 * The security handler for this file and password: { decrypt(bytes, objNum, gen) } or throws password_required / wrong_password / unsupported.
 * A user password is tried (an empty one first when none is given: many files are locked only against editing).
 */
function securityHandler(enc, id0, password) {
    if (!enc || (enc.Filter && enc.Filter.name !== "Standard")) throw fail("unsupported", "This PDF uses a lock type Stashr cannot open. Open it in a PDF viewer, save a copy without the password, and upload that.");
    const V = Number(enc.V || 0), R = Number(enc.R || 2);
    const O = enc.O && enc.O.buf, U = enc.U && enc.U.buf;
    if (!O || !U) throw fail("corrupt", "The PDF's lock information is damaged.");
    const encMeta = enc.EncryptMetadata !== false;
    const method = (name) => { const cf = enc.CF && enc.CF[name]; return cf && cf.CFM ? cf.CFM.name : (name === "Identity" ? "None" : ""); };
    const stmF = enc.StmF ? enc.StmF.name : "Identity";
    const tries = password === undefined || password === "" ? [""] : [String(password), ""];
    let key = null, ok = false;

    if (R >= 5) {
        if (U.length < 48 || !enc.UE) throw fail("corrupt", "The PDF's lock information is damaged.");
        const UE = enc.UE.buf;
        for (const pw of tries) {
            const p = Buffer.from(pw.normalize("NFKC"), "utf8").subarray(0, 127);
            const h = (salt) => (R === 5 ? sha("sha256", p, salt) : hash2B(p, salt, Buffer.alloc(0)));
            if (crypto.timingSafeEqual(h(U.subarray(32, 40)), U.subarray(0, 32))) {
                key = aesCbc(h(U.subarray(40, 48)), Buffer.alloc(16), UE.subarray(0, 32), true, false);
                ok = true; break;
            }
        }
    } else {
        const P = Buffer.alloc(4); P.writeInt32LE(Number(enc.P) | 0, 0);
        const n = R === 2 ? 5 : V === 4 ? 16 : Math.max(5, Math.min(16, Math.floor(Number(enc.Length || 40) / 8)));
        for (const pw of tries) {
            const pb = Buffer.alloc(32, 0); Buffer.from(pw, "latin1").copy(pb, 0, 0, 32); PAD.copy(pb, Math.min(32, Buffer.from(pw, "latin1").length), 0, 32 - Math.min(32, Buffer.from(pw, "latin1").length));
            let k = md5(pb, O.subarray(0, 32), P, id0, R >= 4 && !encMeta ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0));
            if (R >= 3) for (let i = 0; i < 50; i++) k = md5(k.subarray(0, n));
            k = k.subarray(0, n);
            let good;
            if (R === 2) good = rc4(k, PAD).equals(U.subarray(0, 32));
            else {
                let x = rc4(k, md5(PAD, id0));
                for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(k.map((b) => b ^ i)), x);
                good = x.equals(U.subarray(0, 16));
            }
            if (good) { key = k; ok = true; break; }
        }
    }
    if (!ok) throw fail(password === undefined || password === "" ? "password_required" : "wrong_password", password === undefined || password === "" ? "This PDF is locked. Enter its password." : "That password did not unlock the PDF.");

    const aes = V >= 4 ? /AES/.test(method(stmF)) : false;
    const none = V >= 4 && (stmF === "Identity" || method(stmF) === "None");
    return {
        decrypt(bytes, num, gen) {
            if (none) return bytes;
            if (R >= 5) return aesStream(key, bytes);
            const ok2 = Buffer.concat([key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]), aes ? Buffer.from("sAlT") : Buffer.alloc(0)]);
            const objKey = md5(ok2).subarray(0, Math.min(key.length + 5, 16));
            return aes ? aesStream(objKey, bytes) : rc4(objKey, bytes);
        }
    };
}

/* ───────── the document ───────── */

class Doc {
    constructor(buf, password) {
        this.buf = buf;
        this.objs = new Map();            // num -> { gen, value, s0, s1 } (s0/s1: where its stream data is)
        this.cache = new Map();
        this.trailer = {};
        this.scan();
        this.setupSecurity(password);
        this.expandObjectStreams();
    }

    scan() {
        const b = this.buf, re = /(\d+)\s+(\d+)\s+obj\b/g, src = b.toString("latin1");
        let m;
        while ((m = re.exec(src))) {
            const p = new Parser(b, m.index + m[0].length);
            let value;
            try { value = p.value(); } catch (e) { continue; }
            const obj = { gen: Number(m[2]), value, s0: -1, s1: -1 };
            p.skip();
            if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Name) && src.startsWith("stream", p.i)) {
                let s0 = p.i + 6;
                if (b[s0] === 13 && b[s0 + 1] === 10) s0 += 2; else if (b[s0] === 10 || b[s0] === 13) s0 += 1;
                let len = typeof value.Length === "number" ? value.Length : -1, s1 = -1;
                if (len >= 0 && /^\s*endstream/.test(src.substr(s0 + len, 20))) s1 = s0 + len;
                else { const e = src.indexOf("endstream", s0); if (e < 0) continue; s1 = e; if (b[s1 - 1] === 10) s1--; if (b[s1 - 1] === 13) s1--; }
                obj.s0 = s0; obj.s1 = s1;
                re.lastIndex = s1;
            }
            this.objs.set(Number(m[1]), obj);
            if (value && value.Type instanceof Name && value.Type.name === "XRef") Object.assign(this.trailer, value);
        }
        // classic trailers
        const tre = /trailer\b/g;
        while ((m = tre.exec(src))) { try { const d = new Parser(b, m.index + 7).value(); if (d && typeof d === "object") Object.assign(this.trailer, d); } catch (e) { /* skip */ } }
        if (!this.trailer.Root) for (const [n, o] of this.objs) if (o.value && o.value.Type instanceof Name && o.value.Type.name === "Catalog") this.trailer.Root = new Ref(n, o.gen);
    }

    setupSecurity(password) {
        this.sec = null;
        if (!this.trailer.Encrypt) return;
        const enc = this.resolve(this.trailer.Encrypt);
        this.encNum = this.trailer.Encrypt instanceof Ref ? this.trailer.Encrypt.num : -1;
        const id = this.resolve(this.trailer.ID);
        const id0 = Array.isArray(id) && id[0] instanceof Str ? id[0].buf : Buffer.alloc(0);
        this.sec = securityHandler(enc, id0, password);
    }

    resolve(v, depth = 0) {
        while (v instanceof Ref && depth++ < 20) { const o = this.objs.get(v.num); v = o ? o.value : null; }
        return v;
    }

    /** The decoded bytes of a stream object (decrypted, then unpacked). */
    streamOf(ref) {
        const num = ref instanceof Ref ? ref.num : -1;
        if (this.cache.has(num)) return this.cache.get(num);
        const o = this.objs.get(num);
        if (!o || o.s0 < 0) return null;
        const d = o.value;
        let data = this.buf.subarray(o.s0, o.s1);
        const type = d.Type instanceof Name ? d.Type.name : "";
        if (this.sec && type !== "XRef" && num !== this.encNum && !(type === "Metadata")) data = this.sec.decrypt(data, num, o.gen);
        let filters = this.resolve(d.Filter), parms = this.resolve(d.DecodeParms || d.DP);
        filters = filters == null ? [] : Array.isArray(filters) ? filters : [filters];
        parms = Array.isArray(parms) ? parms : [parms];
        filters.forEach((f, i) => {
            const name = (this.resolve(f) || {}).name, p = this.resolve(parms[i]) || {};
            if (name === "FlateDecode" || name === "Fl") {
                data = inflate(data);
                const pr = Number(this.resolve(p.Predictor) || 1);
                if (pr >= 10) data = pngPredict(data, Number(this.resolve(p.Columns) || 1), Number(this.resolve(p.Colors) || 1), Number(this.resolve(p.BitsPerComponent) || 8));
            } else if (name === "ASCII85Decode" || name === "A85") data = ascii85(data);
            else if (name === "ASCIIHexDecode" || name === "AHx") data = Buffer.from(data.toString("latin1").replace(/[^0-9a-fA-F]/g, "").replace(/(^.*$)/, (h) => (h.length % 2 ? h + "0" : h)), "hex");
            else if (name === "Crypt") { /* identity here */ }
            else if (name) throw fail("unsupported", `This PDF uses a compression (${name}) Stashr cannot read.`);
        });
        this.cache.set(num, data);
        return data;
    }

    expandObjectStreams() {
        for (const [num, o] of [...this.objs]) {
            if (!(o.value && o.value.Type instanceof Name && o.value.Type.name === "ObjStm") || o.s0 < 0) continue;
            const data = this.streamOf(new Ref(num, o.gen)), n = Number(this.resolve(o.value.N)), first = Number(this.resolve(o.value.First));
            const head = new Parser(data, 0), pairs = [];
            for (let i = 0; i < n; i++) pairs.push([head.value(), head.value()]);
            for (const [on, off] of pairs) {
                if (this.objs.has(on)) continue;
                try { this.objs.set(on, { gen: 0, value: new Parser(data, first + off).value(), s0: -1, s1: -1 }); } catch (e) { /* skip one */ }
            }
        }
    }
}

/* ───────── fonts ───────── */

const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const CP1252 = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };
const GLYPHS = { space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", minus: "-", period: ".", slash: "/", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", underscore: "_", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", endash: "–", emdash: "—", bullet: "•", rupee: "₹", Euro: "€", periodcentered: "·" };

function glyphChar(name) {
    if (GLYPHS[name] !== undefined) return GLYPHS[name];
    if (/^[A-Za-z]$/.test(name)) return name;
    let m = /^uni([0-9A-Fa-f]{4})$/.exec(name); if (m) return String.fromCharCode(parseInt(m[1], 16));
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(name); if (m) return String.fromCodePoint(parseInt(m[1], 16));
    return "";
}

/** A /ToUnicode CMap: { codeBytes, map: code -> string }. */
function parseCMap(data) {
    const s = data.toString("latin1"), map = new Map();
    let codeBytes = 1;
    const hexU = (h) => { let out = ""; for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return h.length === 2 ? String.fromCharCode(parseInt(h, 16)) : out; };
    for (const m of s.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) { const h = /<([0-9a-fA-F]+)>/.exec(m[1]); if (h) codeBytes = Math.max(codeBytes, h[1].length / 2); }
    for (const m of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(p[1], 16), hexU(p[2]));
    for (const m of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
            const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
            if (hi - lo > 70000) continue;
            if (p[3][0] === "[") { [...p[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((x, i) => map.set(lo + i, hexU(x[1]))); }
            else { const base = parseInt(p[3].slice(1, -1), 16), h = p[3].slice(1, -1); for (let c = lo; c <= hi; c++) map.set(c, h.length <= 4 ? String.fromCharCode(base + c - lo) : hexU((base + c - lo).toString(16).padStart(h.length, "0"))); }
        }
    }
    return { codeBytes, map };
}

function loadFont(doc, fontDict) {
    const d = doc.resolve(fontDict) || {};
    const subtype = (doc.resolve(d.Subtype) || {}).name || "Type1";
    const font = { size1: subtype !== "Type0", widths: new Map(), dw: 1000, toUni: null, twoByte: false, enc: null, mono: false, unmapped: false };
    const tu = d.ToUnicode instanceof Ref ? doc.streamOf(d.ToUnicode) : null;
    if (tu) font.toUni = parseCMap(tu);
    if (subtype === "Type0") {
        font.twoByte = true;
        const df = doc.resolve((doc.resolve(d.DescendantFonts) || [])[0]) || {};
        font.dw = Number(doc.resolve(df.DW) || 1000);
        const W = doc.resolve(df.W) || [];
        for (let i = 0; i < W.length;) {
            const a = doc.resolve(W[i]), b = doc.resolve(W[i + 1]);
            if (Array.isArray(b)) { b.forEach((w, k) => font.widths.set(a + k, Number(doc.resolve(w)))); i += 2; }
            else { for (let c = a; c <= b && c - a < 70000; c++) font.widths.set(c, Number(doc.resolve(W[i + 2]))); i += 3; }
        }
        if (!font.toUni) font.unmapped = true;
        return font;
    }
    const first = Number(doc.resolve(d.FirstChar) || 0), widths = doc.resolve(d.Widths);
    if (Array.isArray(widths)) widths.forEach((w, i) => font.widths.set(first + i, Number(doc.resolve(w))));
    const fd = doc.resolve(d.FontDescriptor) || {};
    font.dw = Number(doc.resolve(fd.MissingWidth) || 0) || (Array.isArray(widths) ? 0 : 556);
    const base = String((doc.resolve(d.BaseFont) || {}).name || "");
    font.mono = /courier|mono/i.test(base);
    // the simple encoding: a name, or a dictionary with differences
    const encV = doc.resolve(d.Encoding), diff = new Map();
    if (encV && typeof encV === "object" && !(encV instanceof Name)) {
        let code = 0;
        for (const x of doc.resolve(encV.Differences) || []) { const v = doc.resolve(x); if (typeof v === "number") code = v; else if (v instanceof Name) diff.set(code++, glyphChar(v.name)); }
    }
    font.enc = diff;
    return font;
}

function decodeText(font, bytes) {
    const out = [];                                    // [{ ch, w }]
    const step = font.twoByte ? (font.toUni && font.toUni.codeBytes === 1 ? 1 : 2) : 1;
    for (let i = 0; i + step <= bytes.length; i += step) {
        const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
        let ch;
        if (font.toUni && font.toUni.map.has(code)) ch = font.toUni.map.get(code);
        else if (font.enc && font.enc.has(code) && font.enc.get(code)) ch = font.enc.get(code);
        else if (font.twoByte) ch = "";
        else ch = CP1252[code] || String.fromCharCode(code);
        let w = font.widths.has(code) ? font.widths.get(code) : (font.size1 && code >= 32 && code <= 126 && font.dw === 556 ? (font.mono ? 600 : HELV[code - 32]) : font.dw);
        if (font.size1 && font.mono && !font.widths.has(code)) w = 600;
        out.push({ ch, w: w || 0, space: code === 32 && step === 1 });
    }
    return out;
}

/* ───────── the content of a page ───────── */

const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];

function interpret(doc, content, resources, ctm0, items, fontCache, depth = 0) {
    const res = doc.resolve(resources) || {};
    const fonts = doc.resolve(res.Font) || {}, xobjs = doc.resolve(res.XObject) || {};
    const p = new Parser(content, 0);
    let ctm = ctm0, stack = [];
    let tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, size = 0, tc = 0, tw = 0, th = 1, tl = 0;
    let args = [];
    const fontFor = (name) => {
        const ref = fonts[name];
        const key = ref instanceof Ref ? `r${ref.num}` : `n${name}${depth}`;
        if (!fontCache.has(key)) fontCache.set(key, loadFont(doc, ref));
        return fontCache.get(key);
    };
    const show = (parts) => {                          // parts: [Buffer | number]
        if (!font) return;
        let text = "", x0 = null, tx = 0, last = 0;
        const base = mul(tm, ctm);
        for (const part of parts) {
            if (typeof part === "number") { tx -= (part / 1000) * size * th; if (part < -200 && text && !text.endsWith(" ")) text += " "; continue; }
            for (const g of decodeText(font, part)) {
                if (x0 === null) x0 = tx;
                text += g.ch;
                tx += ((g.w / 1000) * size + tc + (g.space ? tw : 0)) * th;
            }
            last = tx;
        }
        if (x0 === null) { tm = mul([1, 0, 0, 1, tx, 0], tm); return; }
        const sx = Math.hypot(base[0], base[1]) || 1, sy = Math.hypot(base[2], base[3]) || 1;
        const px = base[0] * x0 + base[2] * 0 + base[4], py = base[1] * x0 + base[3] * 0 + base[5];
        const ex = base[0] * last + base[4];
        if (text.trim()) items.push({ x: px, y: py, x2: ex, size: size * sy, text, scale: sx });
        tm = mul([1, 0, 0, 1, last, 0], tm);
    };
    while (!p.eof()) {
        const v = p.value();
        if (!(v instanceof Kw)) { args.push(v); if (args.length > 200) args = args.slice(-100); continue; }
        const op = v.kw, a = args;
        args = [];
        switch (op) {
            case "q": stack.push([ctm, tm, tlm, font, size, tc, tw, th, tl]); break;
            case "Q": if (stack.length) [ctm, tm, tlm, font, size, tc, tw, th, tl] = stack.pop(); break;
            case "cm": if (a.length >= 6) ctm = mul(a.slice(-6).map(Number), ctm); break;
            case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm; break;
            case "Tf": if (a.length >= 2 && a[a.length - 2] instanceof Name) { font = fontFor(a[a.length - 2].name); size = Number(a[a.length - 1]) || 0; } break;
            case "Tc": tc = Number(a[0]) || 0; break;
            case "Tw": tw = Number(a[0]) || 0; break;
            case "Tz": th = (Number(a[0]) || 100) / 100; break;
            case "TL": tl = Number(a[0]) || 0; break;
            case "Td": tlm = mul([1, 0, 0, 1, Number(a[0]) || 0, Number(a[1]) || 0], tlm); tm = tlm; break;
            case "TD": tl = -(Number(a[1]) || 0); tlm = mul([1, 0, 0, 1, Number(a[0]) || 0, Number(a[1]) || 0], tlm); tm = tlm; break;
            case "Tm": if (a.length >= 6) { tm = a.slice(-6).map(Number); tlm = tm; } break;
            case "T*": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; break;
            case "Tj": if (a[0] instanceof Str) show([a[0].buf]); break;
            case "'": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; if (a[0] instanceof Str) show([a[0].buf]); break;
            case '"': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; if (a[2] instanceof Str) show([a[2].buf]); break;
            case "TJ": if (Array.isArray(a[0])) show(a[0].map((x) => (x instanceof Str ? x.buf : Number(x) || 0))); break;
            case "Do": {
                const ref = a[0] instanceof Name ? xobjs[a[0].name] : null, o = ref instanceof Ref ? doc.objs.get(ref.num) : null;
                if (o && o.s0 >= 0 && depth < 5 && ((doc.resolve(o.value.Subtype) || {}).name === "Form")) {
                    const m = (doc.resolve(o.value.Matrix) || [1, 0, 0, 1, 0, 0]).map((x) => Number(doc.resolve(x)));
                    interpret(doc, doc.streamOf(ref), o.value.Resources || resources, mul(m, ctm), items, fontCache, depth + 1);
                }
                break;
            }
            case "BI": {                                // an inline image: skip to its end
                const s = p.b.toString("latin1", p.i), e = s.search(/\sEI(\s|$)/);
                p.i = e < 0 ? p.b.length : p.i + e + 3;
                break;
            }
            default: break;
        }
    }
}

/* ───────── public ───────── */

function isPdf(buf) { return Buffer.isBuffer(buf) && buf.length > 8 && buf.subarray(0, 1024).toString("latin1").includes("%PDF-"); }

/** Is a password needed to open this file? (false when it is not locked, or opens with an empty password.) */
function needsPassword(buf) {
    try { new Doc(buf, undefined); return false; } catch (e) { if (e.code === "password_required") return true; throw e; }
}

function openPdf(buf, password) {
    if (!isPdf(buf)) throw fail("not_pdf", "This is not a PDF file.");
    const doc = new Doc(buf, password);
    const root = doc.resolve(doc.trailer.Root);
    if (!root) throw fail("corrupt", "This PDF is damaged (no page list).");
    const pages = [];
    const walk = (node, inherited, depth = 0) => {
        const d = doc.resolve(node);
        if (!d || depth > 30) return;
        const inh = { Resources: d.Resources || inherited.Resources, MediaBox: d.MediaBox || inherited.MediaBox };
        const type = (doc.resolve(d.Type) || {}).name;
        if (type === "Pages" || (d.Kids && !d.Contents)) { for (const k of doc.resolve(d.Kids) || []) walk(k, inh, depth + 1); return; }
        pages.push({ dict: d, inh });
    };
    walk(root.Pages, {});
    if (!pages.length) throw fail("corrupt", "This PDF has no pages.");
    const fontCache = new Map(), out = [];
    for (const { dict, inh } of pages) {
        const box = (doc.resolve(inh.MediaBox) || [0, 0, 595, 842]).map((x) => Number(doc.resolve(x)));
        const contents = doc.resolve(dict.Contents);
        const refs = Array.isArray(contents) ? contents : contents ? [dict.Contents] : [];
        const data = Buffer.concat(refs.flatMap((r) => { const s = doc.streamOf(r); return s ? [s, Buffer.from("\n")] : []; }));
        const items = [];
        interpret(doc, data, inh.Resources, [1, 0, 0, 1, -box[0], -box[1]], items, fontCache);
        out.push({ width: box[2] - box[0], height: box[3] - box[1], items });
    }
    const total = out.reduce((n, p) => n + p.items.length, 0);
    if (!total) throw fail("no_text", "This PDF has no readable text (it may be a scan or a picture). Download the statement as Excel or CSV from net banking instead.");
    if (fontCache.size && [...fontCache.values()].every((f) => f.unmapped)) throw fail("unsupported", "This PDF's fonts cannot be read as text. Download the statement as Excel or CSV from net banking instead.");
    return { pages: out };
}

module.exports = { openPdf, isPdf, needsPassword, Parser, parseCMap };
