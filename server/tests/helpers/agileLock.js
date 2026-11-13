/* Test helper: locks an .xlsx the way Excel 2010+ does ("Agile" encryption, AES-256-CBC, SHA-512) inside a small OLE compound file. */
const crypto = require("crypto");

const BLOCK = { verifierInput: Buffer.from("fea7d2763b4b9e79", "hex"), verifierValue: Buffer.from("d7aa0f6d3061344e", "hex"), keyValue: Buffer.from("146e0be7abacd0d6", "hex") };
const sha512 = (...p) => crypto.createHash("sha512").update(Buffer.concat(p)).digest();
const cbc = (key, iv, data) => { const c = crypto.createCipheriv("aes-256-cbc", key, iv); c.setAutoPadding(false); return Buffer.concat([c.update(data), c.final()]); };
const padTo16 = (b) => (b.length % 16 ? Buffer.concat([b, Buffer.alloc(16 - (b.length % 16))]) : b);

function agileLock(xlsx, password, { spin = 1000 } = {}) {
    const keyDataSalt = crypto.randomBytes(16), salt = crypto.randomBytes(16), key = crypto.randomBytes(32), verifier = crypto.randomBytes(16);
    let h = sha512(salt, Buffer.from(password, "utf16le"));
    for (let i = 0; i < spin; i++) { const n = Buffer.alloc(4); n.writeUInt32LE(i, 0); h = sha512(n, h); }
    const bk = (block) => sha512(h, block).subarray(0, 32);
    const encVerInput = cbc(bk(BLOCK.verifierInput), salt, padTo16(verifier));
    const encVerValue = cbc(bk(BLOCK.verifierValue), salt, padTo16(sha512(verifier)));
    const encKey = cbc(bk(BLOCK.keyValue), salt, key);

    const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(xlsx.length), 0);
    const parts = [size];
    for (let seg = 0, off = 0; off < xlsx.length; seg++, off += 4096) {
        const n = Buffer.alloc(4); n.writeUInt32LE(seg, 0);
        parts.push(cbc(key, sha512(keyDataSalt, n).subarray(0, 16), padTo16(xlsx.subarray(off, off + 4096))));
    }
    const pkg = Buffer.concat(parts);
    const b64 = (b) => b.toString("base64");
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">` +
        `<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(keyDataSalt)}"/>` +
        `<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password"><p:encryptedKey spinCount="${spin}" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="${b64(salt)}" encryptedVerifierHashInput="${b64(encVerInput)}" encryptedVerifierHashValue="${b64(encVerValue)}" encryptedKeyValue="${b64(encKey)}"/></keyEncryptor></keyEncryptors></encryption>`;
    const head = Buffer.alloc(8); head.writeUInt16LE(4, 0); head.writeUInt16LE(4, 2); head.writeUInt32LE(0x40, 4);
    return compound({ EncryptionInfo: Buffer.concat([head, Buffer.from(xml)]), EncryptedPackage: pkg });
}

/** A minimal OLE compound file with two top-level streams, all in ordinary sectors (the header's mini-stream cutoff is 0). */
function compound(streams) {
    const S = 512, END = 0xfffffffe, FREE = 0xffffffff;
    const names = Object.keys(streams), chunks = names.map((n) => Math.max(1, Math.ceil(streams[n].length / S)));
    const total = 2 + chunks.reduce((a, b) => a + b, 0);
    if (total > 128) throw new Error("test helper: file too big");
    const fat = new Array(128).fill(FREE); fat[0] = 0xfffffffd; fat[1] = END;
    const starts = []; let next = 2;
    chunks.forEach((c, i) => { starts.push(next); for (let k = 0; k < c; k++) { fat[next + k] = k === c - 1 ? END : next + k + 1; } next += c; });
    const header = Buffer.alloc(512, 0);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
    header.writeUInt16LE(0x3e, 24); header.writeUInt16LE(3, 26); header.writeUInt16LE(0xfffe, 28); header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32);
    header.writeUInt32LE(1, 44); header.writeUInt32LE(1, 48); header.writeUInt32LE(0, 56); header.writeUInt32LE(END, 60); header.writeUInt32LE(0, 64); header.writeUInt32LE(END, 68); header.writeUInt32LE(0, 72);
    for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : FREE, 76 + i * 4);
    const fatSector = Buffer.alloc(S); fat.forEach((v, i) => fatSector.writeUInt32LE(v, i * 4));
    const dir = Buffer.alloc(S, 0);
    const entry = (i, name, type, start, size, left, right, child) => {
        const o = i * 128, nm = Buffer.from(name, "utf16le");
        nm.copy(dir, o); dir.writeUInt16LE(nm.length + 2, o + 64); dir[o + 66] = type; dir[o + 67] = 1;
        dir.writeUInt32LE(left, o + 68); dir.writeUInt32LE(right, o + 72); dir.writeUInt32LE(child, o + 76); dir.writeUInt32LE(start, o + 116); dir.writeUInt32LE(size, o + 120);
    };
    entry(0, "Root Entry", 5, END, 0, FREE, FREE, 1);
    names.forEach((n, i) => entry(i + 1, n, 2, starts[i], streams[n].length, FREE, i + 1 < names.length ? i + 2 : FREE, FREE));
    for (let i = names.length + 1; i < 4; i++) dir.writeUInt32LE(FREE, i * 128 + 68), dir.writeUInt32LE(FREE, i * 128 + 72), dir.writeUInt32LE(FREE, i * 128 + 76);
    const body = names.map((n, i) => { const b = Buffer.alloc(chunks[i] * S); streams[n].copy(b); return b; });
    return Buffer.concat([header, fatSector, dir, ...body]);
}

module.exports = { agileLock, compound };
