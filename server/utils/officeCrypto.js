/**
 * Opening a password-protected Excel file (.xlsx), with Node's own crypto and no libraries.
 *
 * Excel saves a locked workbook as an OLE "compound file" (starts D0 CF 11 E0) holding two streams: EncryptionInfo (how it was locked)
 * and EncryptedPackage (the real .xlsx, encrypted). This reads that container, checks the password and returns the plain .xlsx bytes.
 * Supported: "Agile" encryption (Excel 2010 and newer: AES 128/192/256 in CBC mode, SHA-1/256/384/512) and "Standard" encryption (Excel 2007,
 * and what LibreOffice and some bank tools write: AES in ECB mode, SHA-1). Anything else is refused with a clear message.
 * Specification: MS-OFFCRYPTO (2.3.4.5 Standard and 2.3.4.10 Agile Encryption) and MS-CFB.
 */
const crypto = require("crypto");

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff;

const fail = (code, message) => Object.assign(new Error(message), { code, status: 400 });

/** Is this an OLE compound file (a locked workbook, or an old .xls)? */
const isCompoundFile = (buf) => Buffer.isBuffer(buf) && buf.length > 512 && buf.subarray(0, 8).equals(SIGNATURE);

/** The streams of a compound file: { name -> Buffer } (only the top level, which is all an encrypted workbook needs). */
function readStreams(buf) {
    if (!isCompoundFile(buf)) throw fail("not_compound", "This is not a protected Excel file.");
    const sectorSize = 1 << buf.readUInt16LE(30), miniSize = 1 << buf.readUInt16LE(32);
    const nFat = buf.readUInt32LE(44), dirStart = buf.readUInt32LE(48), cutoff = buf.readUInt32LE(56);
    const miniFatStart = buf.readUInt32LE(60), nMiniFat = buf.readUInt32LE(64), difatStart = buf.readUInt32LE(68), nDifat = buf.readUInt32LE(72);
    const sector = (n) => { const o = (n + 1) * sectorSize; if (o + sectorSize > buf.length) throw fail("corrupt", "The Excel file is damaged."); return buf.subarray(o, o + sectorSize); };

    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) { const s = buf.readUInt32LE(76 + i * 4); if (s !== FREESECT) fatSectors.push(s); }
    let d = difatStart;
    for (let i = 0; i < nDifat && d !== ENDOFCHAIN && d !== FREESECT; i++) {
        const sec = sector(d);
        for (let j = 0; j < sectorSize / 4 - 1 && fatSectors.length < nFat; j++) { const s = sec.readUInt32LE(j * 4); if (s !== FREESECT) fatSectors.push(s); }
        d = sec.readUInt32LE(sectorSize - 4);
    }
    const fat = [];
    for (const s of fatSectors) { const sec = sector(s); for (let j = 0; j < sectorSize / 4; j++) fat.push(sec.readUInt32LE(j * 4)); }

    const chain = (start, table) => { const out = []; for (let s = start, guard = 0; s !== ENDOFCHAIN && s !== FREESECT && guard < 1e6; guard++) { out.push(s); s = table[s]; if (s === undefined) break; } return out; };
    const readChain = (start) => Buffer.concat(chain(start, fat).map(sector));

    const dir = readChain(dirStart);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
        const nameLen = dir.readUInt16LE(o + 64);
        if (!nameLen) continue;
        entries.push({ name: dir.toString("utf16le", o, o + nameLen - 2), type: dir[o + 66], start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) });
    }
    const root = entries.find((e) => e.type === 5);
    let miniStream = null, miniFat = null;
    const loadMini = () => {
        if (miniStream) return;
        miniStream = root ? readChain(root.start) : Buffer.alloc(0);
        const mf = readChain(miniFatStart).subarray(0, nMiniFat * sectorSize);
        miniFat = []; for (let j = 0; j + 4 <= mf.length; j += 4) miniFat.push(mf.readUInt32LE(j));
    };
    const out = {};
    for (const e of entries) {
        if (e.type !== 2) continue;
        if (e.size < cutoff) {
            loadMini();
            out[e.name] = Buffer.concat(chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize))).subarray(0, e.size);
        } else out[e.name] = readChain(e.start).subarray(0, e.size);
    }
    return out;
}

/** True for a compound file that holds an encrypted workbook (so a password is needed), false for anything else (an old .xls, say). */
function isEncryptedWorkbook(buf) {
    if (!isCompoundFile(buf)) return false;
    try { const s = readStreams(buf); return Boolean(s.EncryptionInfo && s.EncryptedPackage); } catch (e) { return false; }
}

const HASHES = { SHA1: "sha1", SHA256: "sha256", SHA384: "sha384", SHA512: "sha512" };
const attr = (xml, tag, name) => { const t = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`).exec(xml); const a = t && new RegExp(`\\b${name}="([^"]*)"`).exec(t[1]); return a ? a[1] : ""; };
const BLOCK = { verifierInput: Buffer.from("fea7d2763b4b9e79", "hex"), verifierValue: Buffer.from("d7aa0f6d3061344e", "hex"), keyValue: Buffer.from("146e0be7abacd0d6", "hex") };

/** The key bytes for a block: hash(H + blockKey) cut or padded (with 0x36) to the key length. */
function blockKey(algo, h, block, bytes) {
    const k = crypto.createHash(algo).update(Buffer.concat([h, block])).digest();
    return k.length >= bytes ? k.subarray(0, bytes) : Buffer.concat([k, Buffer.alloc(bytes - k.length, 0x36)]);
}

const cbc = (bits, key, iv, data) => {
    const d = crypto.createDecipheriv(`aes-${bits}-cbc`, key, iv);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(data), d.final()]);
};

const UNSUPPORTED = "This Excel file uses a lock type Stashr cannot open. Open it in Excel, remove the password (File > Info > Protect Workbook), save, and upload that.";
const sha1 = (...parts) => crypto.createHash("sha1").update(Buffer.concat(parts)).digest();
const ecb = (key, data) => {
    const d = crypto.createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
    d.setAutoPadding(false);
    return Buffer.concat([d.update(data), d.final()]);
};

/** Standard encryption (version 2/3/4 . 2): AES-ECB with a key made from the password by 50,000 rounds of SHA-1. */
function decryptStandard(info, pkg, password) {
    const headerSize = info.readUInt32LE(8), header = info.subarray(12, 12 + headerSize);
    const algId = header.readUInt32LE(8), hashId = header.readUInt32LE(12), keyBits = header.readUInt32LE(16);
    if (![0x660e, 0x660f, 0x6610].includes(algId) || hashId !== 0x8004 || ![128, 192, 256].includes(keyBits)) throw fail("unsupported", UNSUPPORTED);
    const v = info.subarray(12 + headerSize);
    const saltSize = v.readUInt32LE(0), salt = v.subarray(4, 4 + saltSize);
    const encVerifier = v.subarray(4 + saltSize, 20 + saltSize), verifierHashSize = v.readUInt32LE(20 + saltSize), encVerifierHash = v.subarray(24 + saltSize, 24 + saltSize + 32);

    let h = sha1(salt, Buffer.from(String(password), "utf16le"));
    const idx = Buffer.alloc(4);
    for (let i = 0; i < 50000; i++) { idx.writeUInt32LE(i, 0); h = sha1(idx, h); }
    const hFinal = sha1(h, Buffer.alloc(4));
    const pad = (byte) => { const b = Buffer.alloc(64, byte); for (let i = 0; i < hFinal.length; i++) b[i] ^= hFinal[i]; return b; };
    const key = Buffer.concat([sha1(pad(0x36)), sha1(pad(0x5c))]).subarray(0, keyBits / 8);

    let ok = false;
    try {
        const verifier = ecb(key, encVerifier);
        const verifierHash = ecb(key, encVerifierHash).subarray(0, verifierHashSize);
        ok = crypto.timingSafeEqual(sha1(verifier).subarray(0, verifierHashSize), verifierHash);
    } catch (e) { ok = false; }
    if (!ok) throw fail("wrong_password", "That password did not unlock the statement.");

    const size = Number(pkg.readBigUInt64LE(0));
    let data = pkg.subarray(8);
    if (data.length % 16) data = Buffer.concat([data, Buffer.alloc(16 - (data.length % 16))]);
    return ecb(key, data).subarray(0, size);
}

/** -> the plain .xlsx bytes. Throws an Error with .code "wrong_password", "unsupported" or "corrupt". */
function decryptWorkbook(buf, password) {
    const streams = readStreams(buf);
    const info = streams.EncryptionInfo, pkg = streams.EncryptedPackage;
    if (!info || !pkg) throw fail("not_encrypted", "This Excel file is not password protected.");
    const major = info.readUInt16LE(0), minor = info.readUInt16LE(2);
    if (minor === 2 && major >= 2 && major <= 4) {
        const plain = decryptStandard(info, pkg, password);
        if (plain.subarray(0, 2).toString() !== "PK") throw fail("corrupt", "The statement unlocked, but its content is damaged.");
        return plain;
    }
    if (!(major === 4 && minor === 4)) throw fail("unsupported", UNSUPPORTED);
    const xml = info.subarray(8).toString("utf8");

    const keyDataSalt = Buffer.from(attr(xml, "keyData", "saltValue"), "base64");
    const kdBits = Number(attr(xml, "keyData", "keyBits")), kdBlock = Number(attr(xml, "keyData", "blockSize")) || 16, kdHash = HASHES[attr(xml, "keyData", "hashAlgorithm")];
    const spin = Number(attr(xml, "encryptedKey", "spinCount")), eSalt = Buffer.from(attr(xml, "encryptedKey", "saltValue"), "base64");
    const eBits = Number(attr(xml, "encryptedKey", "keyBits")), eHash = HASHES[attr(xml, "encryptedKey", "hashAlgorithm")];
    const eHashSize = Number(attr(xml, "encryptedKey", "hashSize")), eBlock = Number(attr(xml, "encryptedKey", "blockSize")) || 16;
    const chaining = attr(xml, "encryptedKey", "cipherChaining") || attr(xml, "keyData", "cipherChaining");
    if (!kdHash || !eHash || ![128, 192, 256].includes(eBits) || ![128, 192, 256].includes(kdBits) || attr(xml, "keyData", "cipherAlgorithm") !== "AES" || chaining !== "ChainingModeCBC" || !spin || spin > 10_000_000) {
        throw fail("unsupported", UNSUPPORTED);
    }
    const encVerInput = Buffer.from(attr(xml, "encryptedKey", "encryptedVerifierHashInput"), "base64");
    const encVerValue = Buffer.from(attr(xml, "encryptedKey", "encryptedVerifierHashValue"), "base64");
    const encKeyValue = Buffer.from(attr(xml, "encryptedKey", "encryptedKeyValue"), "base64");

    // the password -> a hash, spun spinCount times
    let h = crypto.createHash(eHash).update(Buffer.concat([eSalt, Buffer.from(String(password), "utf16le")])).digest();
    const idx = Buffer.alloc(4);
    for (let i = 0; i < spin; i++) { idx.writeUInt32LE(i, 0); h = crypto.createHash(eHash).update(Buffer.concat([idx, h])).digest(); }

    const iv = eSalt.subarray(0, eBlock);
    let ok = false;
    try {
        const verifier = cbc(eBits, blockKey(eHash, h, BLOCK.verifierInput, eBits / 8), iv, encVerInput).subarray(0, eSalt.length);
        const verifierHash = cbc(eBits, blockKey(eHash, h, BLOCK.verifierValue, eBits / 8), iv, encVerValue).subarray(0, eHashSize);
        ok = crypto.timingSafeEqual(crypto.createHash(eHash).update(verifier).digest().subarray(0, eHashSize), verifierHash);
    } catch (e) { ok = false; }
    if (!ok) throw fail("wrong_password", "That password did not unlock the statement.");

    const key = cbc(eBits, blockKey(eHash, h, BLOCK.keyValue, eBits / 8), iv, encKeyValue).subarray(0, kdBits / 8);
    const size = Number(pkg.readBigUInt64LE(0));
    const data = pkg.subarray(8);
    const out = [];
    for (let seg = 0, off = 0; off < data.length; seg++, off += 4096) {
        const sn = Buffer.alloc(4); sn.writeUInt32LE(seg, 0);
        const segIv = crypto.createHash(kdHash).update(Buffer.concat([keyDataSalt, sn])).digest().subarray(0, kdBlock);
        let chunk = data.subarray(off, off + 4096);
        if (chunk.length % 16) chunk = Buffer.concat([chunk, Buffer.alloc(16 - (chunk.length % 16))]);
        out.push(cbc(kdBits, key, segIv, chunk));
    }
    const plain = Buffer.concat(out).subarray(0, size);
    if (plain.subarray(0, 2).toString() !== "PK") throw fail("corrupt", "The statement unlocked, but its content is damaged.");
    return plain;
}

module.exports = { isCompoundFile, isEncryptedWorkbook, decryptWorkbook, readStreams };
