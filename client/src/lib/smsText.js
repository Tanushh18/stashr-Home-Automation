/* SMS length rules for the SMS sender, kept apart from React so they can be tested. */

// The GSM 7-bit alphabet (basic set plus the extension table, which costs two characters each).
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";
const BASIC = new Set(GSM_BASIC);
const EXT = new Set(GSM_EXT);

/**
 * How a message goes out: { encoding: "GSM" | "Unicode", chars, parts, perPart }. Plain English text fits 160 characters in one SMS
 * (153 per part when longer); one emoji or Hindi letter turns the whole message to Unicode: 70 per SMS, 67 per part.
 * `{name}` counts as 10 characters (a typical first name).
 */
export function smsInfo(text) {
  const t = String(text || "").replace(/\{name\}/gi, "Xxxxxxxxxx");
  const chars = [...t];
  const gsm = chars.every((c) => BASIC.has(c) || EXT.has(c));
  if (gsm) {
    const n = chars.reduce((k, c) => k + (EXT.has(c) ? 2 : 1), 0);
    const parts = n === 0 ? 0 : n <= 160 ? 1 : Math.ceil(n / 153);
    return { encoding: "GSM", chars: n, parts, perPart: n <= 160 ? 160 : 153 };
  }
  const n = t.length;                                    // UTF-16 units: an emoji counts twice, as on the phone
  const parts = n === 0 ? 0 : n <= 70 ? 1 : Math.ceil(n / 67);
  return { encoding: "Unicode", chars: n, parts, perPart: n <= 70 ? 70 : 67 };
}

/** The most SMS parts any of the messages takes (what one person may cost). */
export const maxParts = (texts) => (texts || []).reduce((m, t) => Math.max(m, smsInfo(t).parts), 0);
