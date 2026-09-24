/** Money: exact minor-unit math, and formatting in each currency's home locale
 * (IDR reads "Rp 7.500.000" whatever the browser's language is). */

/** Home locale per currency. Anything missing falls back to "en". */
const LOCALES: Record<string, string> = {
  IDR: "id-ID", USD: "en-US", EUR: "de-DE", GBP: "en-GB", JPY: "ja-JP", SGD: "en-SG", MYR: "ms-MY", THB: "th-TH",
  PHP: "en-PH", VND: "vi-VN", INR: "en-IN", CNY: "zh-CN", KRW: "ko-KR", AUD: "en-AU", CAD: "en-CA", CHF: "de-CH",
  HKD: "zh-HK", TWD: "zh-TW", BRL: "pt-BR", MXN: "es-MX", NZD: "en-NZ", SEK: "sv-SE", NOK: "nb-NO", DKK: "da-DK",
  PLN: "pl-PL", CZK: "cs-CZ", HUF: "hu-HU", TRY: "tr-TR", RUB: "ru-RU", ZAR: "en-ZA", ARS: "es-AR", CLP: "es-CL",
  COP: "es-CO", PEN: "es-PE", PKR: "en-PK", NGN: "en-NG", KES: "en-KE",
};

export function currencyLocale(currency: string): string {
  return LOCALES[currency] ?? "en";
}

/* Minor-unit exponent. It gives stored amounts their meaning, so it comes from a fixed locale ("en"),
 * never the viewer's. Engines disagree for a few currencies (JavaScriptCore, as in Safari and Bun, says 2–3
 * where V8, as in Chrome and Node SSR, says 0), so those are pinned to the V8 values the app has always used. */
const PINNED_EXPONENT: Record<string, number> = Object.fromEntries(
  "AFN ALL COP HUF IDR IQD IRR KPW LAK LBP MGA MMK PKR SLL SOS SYP YER".split(" ").map((c) => [c, 0]),
);

const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

export function exponent(currency: string): number {
  return cached(`exp:${currency}`, () => {
    if (currency in PINNED_EXPONENT) return PINNED_EXPONENT[currency];
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      return 2;
    }
  });
}

/** Native currency formatter with exactly `exponent` fraction digits (null if Intl rejects the code). */
function moneyFormat(currency: string, fractionDigits = exponent(currency)): Intl.NumberFormat | null {
  return cached(`nf:${currency}:${fractionDigits}`, () => {
    try {
      return new Intl.NumberFormat(currencyLocale(currency), {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
        numberingSystem: "latn",
      });
    } catch {
      return null;
    }
  });
}

/** Minor units -> native currency text, e.g. (750000000, "IDR") -> "Rp 7.500.000", (1050, "EUR") -> "10,50 €". */
export function formatMoney(amount_minor: number, currency: string): string {
  const decimal = fromMinor(amount_minor, currency);
  const nf = moneyFormat(currency);
  // A decimal string keeps big amounts exact (Intl.NumberFormat v3).
  return nf ? nf.format(decimal as Intl.StringNumericLiteral) : `${decimal} ${currency}`;
}

/** Money with an explicit sign: "+$12.00", "−$4.50" (true minus sign), "$0.00". */
export function signedMoney(amount_minor: number, currency: string): string {
  const sign = amount_minor > 0 ? "+" : amount_minor < 0 ? "−" : "";
  return sign + formatMoney(Math.abs(amount_minor), currency);
}

/** Parses a canonical decimal string ("10.5") into minor units (1050) with string math, so there's no float drift. */
export function toMinor(input: string, currency: string): number {
  const exp = exponent(currency);
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const digitsOnly = trimmed.replace(/^-/, "").replace(/[^0-9.]/g, "");
  const [intPart, fracPart = ""] = digitsOnly.split(".");
  const frac = (fracPart + "0".repeat(exp)).slice(0, exp);
  const value = parseInt(`${intPart || "0"}${frac}`, 10) || 0;
  return negative ? -value : value;
}

/** Inverse of toMinor: minor units (1050) -> canonical decimal string ("10.50"). */
export function fromMinor(amount_minor: number, currency: string): string {
  const exp = exponent(currency);
  const negative = amount_minor < 0;
  const abs = Math.abs(amount_minor).toString().padStart(exp + 1, "0");
  if (exp === 0) return `${negative ? "-" : ""}${abs}`;
  return `${negative ? "-" : ""}${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
}

// --- amount input -------------------------------------------------------------
// The form keeps a canonical value ("1234.5": digits, optional "." and at most `exponent` decimals);
// the field shows it natively grouped ("1.234,5" for EUR) and re-groups on every keystroke.

/** The currency's native group and decimal separators, from its own formatter. */
export function separators(currency: string): { group: string; decimal: string } {
  return cached(`sep:${currency}`, () => {
    const parts = moneyFormat(currency, 2)?.formatToParts(1234567.5) ?? [];
    return {
      group: parts.find((p) => p.type === "group")?.value ?? ",",
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    };
  });
}

/** Canonical value -> field text: "1234.5" -> "1,234.5" (USD) / "1.234,5" (EUR); "12345" -> "12,345" (INR "12,345", lakh from 1,00,000). */
export function formatAmountInput(value: string, currency: string): string {
  if (!value) return "";
  const [int, frac] = value.split(".");
  const parts = moneyFormat(currency, 0)?.formatToParts((int || "0") as Intl.StringNumericLiteral);
  const grouped = parts ? parts.filter((p) => p.type === "integer" || p.type === "group").map((p) => p.value).join("") : int;
  return frac === undefined ? grouped : grouped + separators(currency).decimal + frac;
}

/** Max integer digits, so amount_minor stays a safe integer (< 2^53 ≈ 9e15). */
const MAX_DIGITS = 15;

/** Turns loose "digits with one optional '.'" into a canonical value, moving `caret` (a count of those chars) along. */
function normalize(raw: string, exp: number, caret: number): { value: string; caret: number } {
  if (!/\d|\./.test(raw)) return { value: "", caret: 0 };
  const dot = raw.indexOf(".");
  let int = dot < 0 ? raw : raw.slice(0, dot);
  let frac: string | null = dot < 0 ? null : raw.slice(dot + 1);
  if (frac !== null && exp === 0) {
    caret = Math.min(caret, int.length);
    frac = null;
  }
  if (int.length > MAX_DIGITS - exp) {
    const cut = int.length - (MAX_DIGITS - exp);
    caret = caret > MAX_DIGITS - exp ? Math.max(MAX_DIGITS - exp, caret - cut) : caret;
    int = int.slice(0, MAX_DIGITS - exp);
  }
  if (frac !== null) {
    frac = frac.slice(0, exp);
    caret = Math.min(caret, int.length + 1 + frac.length);
  }
  const before = caret;
  const stripped = int.replace(/^0+/, "");
  caret -= Math.min(int.length - stripped.length, caret);
  if (!stripped && (int || frac !== null)) {
    int = "0";
    if (before > 0) caret++;
  } else {
    int = stripped;
  }
  return { value: frac === null ? int : `${int}.${frac}`, caret };
}

/** Reads pasted/filled text in either separator style into loose "digits[.digits]":
 * "1.234,56" / "1,234.56" -> "1234.56"; "7.500.000" -> "7500000"; a lone separator before exactly
 * three digits is a thousands group ("75.000" -> "75000"), otherwise it's the decimal point ("12,5"). */
function readLoose(text: string, exp: number): string {
  const s = text.replace(/[^\d.,]/g, "");
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (last < 0) return s;
  const mixed = s.includes(".") && s.includes(",");
  const lone = s.split(s[last]).length === 2;
  const before = s.slice(0, last).replace(/\D/g, "");
  const after = s.slice(last + 1);
  const looksGrouped = after.length === 3 && exp !== 3 && /[1-9]/.test(before);
  if (mixed || (lone && !looksGrouped)) return `${before}.${after}`;
  return s.replace(/\D/g, "");
}

/** Pasted/typed text -> canonical value for the currency. */
export function parseAmount(text: string, currency: string): string {
  const exp = exponent(currency);
  return normalize(readLoose(text, exp), exp, 0).value;
}

/** Re-fits a canonical value to a (new) currency's decimals: "12.50" -> "12" for IDR. */
export function fitAmount(value: string, currency: string): string {
  return normalize(value, exponent(currency), 0).value;
}

/**
 * One edit of the amount field. `prev` is what the field showed, `next` what the browser made of it after the
 * keystroke/paste, `caret` the browser's selectionStart. Returns the canonical value, the re-grouped text and
 * where the caret goes in it (after the same digits it was after).
 *
 * The inserted text is found by diffing prev/next around the caret; the untouched parts are read with the
 * native separators, the inserted part as typed: a single "." or "," always means "decimal point" (keypads
 * differ), a longer paste is read in either style. Deleting only a group separator deletes the digit next to it.
 */
export function editAmount(
  prev: string,
  next: string,
  caret: number | null,
  currency: string,
  inputType = "",
): { value: string; text: string; caret: number } {
  const exp = exponent(currency);
  const { decimal } = separators(currency);
  const end = Math.min(caret ?? next.length, next.length);

  let s = 0;
  while (s < prev.length && s < next.length - end && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  let p = 0;
  while (p < Math.min(prev.length, next.length) - s && prev[p] === next[p]) p++;

  // Field text we rendered: digits stay, the native decimal becomes ".", group separators go.
  const own = (t: string) => [...t].map((ch) => (/\d/.test(ch) ? ch : ch === decimal ? "." : "")).join("");
  let left = own(prev.slice(0, p));
  let right = own(prev.slice(prev.length - s));
  const removed = prev.slice(p, prev.length - s);
  const typed = next.slice(p, next.length - s);
  let inserted =
    typed.length === 1
      ? /\d/.test(typed) ? typed : /[.,]/.test(typed) || typed === decimal ? "." : ""
      : readLoose(typed, exp);

  if (!typed && removed && !own(removed)) {
    // Only a group separator went: take the digit beside it instead, or the edit would be a no-op.
    if (inputType === "deleteContentForward") right = right.replace(/^\d/, "");
    else left = left.replace(/\d$/, "");
  }
  if (inserted.includes(".") && (left + right).includes(".")) inserted = inserted.replace(".", "");

  const out = normalize(left + inserted + right, exp, left.length + inserted.length);
  const text = formatAmountInput(out.value, currency);
  let pos = 0;
  for (let seen = 0; pos < text.length && seen < out.caret; pos++) {
    if (/\d/.test(text[pos]) || text[pos] === decimal) seen++;
  }
  return { value: out.value, text, caret: pos };
}

// --- picker data -----------------------------------------------------------------

export type CurrencyOption = { code: string; name: string; symbol: string };

const FALLBACK_CODES = Object.keys(LOCALES);

/** Every currency the browser knows, with its English name and native symbol ("IDR", "Indonesian Rupiah", "Rp"). */
export function currencyOptions(): CurrencyOption[] {
  return cached("options", () => {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    const codes = supported ? supported("currency") : FALLBACK_CODES;
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames(["en"], { type: "currency" });
    } catch {}
    return codes.map((code) => ({ code, name: names?.of(code) ?? code, symbol: currencySymbol(code) }));
  });
}

export function currencySymbol(currency: string): string {
  return moneyFormat(currency)?.formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
}

export function currencyName(currency: string): string {
  return currencyOptions().find((o) => o.code === currency)?.name ?? currency;
}

/** Search by code, name or symbol; exact code first, then code prefix, then the rest. */
export function searchCurrencies(query: string, options = currencyOptions()): CurrencyOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const rank = (o: CurrencyOption) => {
    const code = o.code.toLowerCase();
    if (code === q) return 0;
    if (code.startsWith(q)) return 1;
    if (o.symbol.toLowerCase() === q) return 2;
    if (o.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))) return 3;
    return o.name.toLowerCase().includes(q) ? 4 : 9;
  };
  return options
    .map((o) => [rank(o), o] as const)
    .filter(([r]) => r < 9)
    .sort((a, b) => a[0] - b[0])
    .map(([, o]) => o);
}

// --- default currency guess ----------------------------------------------------------

const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
const REGION_CURRENCY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((r) => [r, "EUR"])),
  US: "USD", ID: "IDR", GB: "GBP", JP: "JPY", SG: "SGD", MY: "MYR", TH: "THB", PH: "PHP", VN: "VND", IN: "INR",
  CN: "CNY", KR: "KRW", AU: "AUD", CA: "CAD", CH: "CHF", HK: "HKD", TW: "TWD", BR: "BRL", MX: "MXN", NZ: "NZD",
  SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", TR: "TRY", RU: "RUB", ZA: "ZAR", AR: "ARS",
  CL: "CLP", CO: "COP", PE: "PEN", PK: "PKR", NG: "NGN", KE: "KES", AE: "AED", SA: "SAR", IL: "ILS", EG: "EGP",
};

/** A starting default currency from a language tag's region ("id-ID" / "id" -> IDR); USD when unknown. */
export function guessCurrency(language: string): string {
  try {
    return REGION_CURRENCY[new Intl.Locale(language).maximize().region ?? ""] ?? "USD";
  } catch {
    return "USD";
  }
}
