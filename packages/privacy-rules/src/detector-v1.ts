import type {
  PrivacyBoundaryAllowed,
  PrivacyBoundaryBlockedMatch,
  PrivacyRuleFamily,
} from "./contracts.js";

export const detectorV1RuleSetVersion = "privacy-detector-v1" as const;

export type DetectorV1Result = PrivacyBoundaryAllowed | PrivacyBoundaryBlockedMatch;

const labeledRules: readonly [PrivacyRuleFamily, RegExp][] = [
  [
    "CARD_SECRET_LABEL_V1",
    /(?:\b(?:cvv|cvc|pin|otp|kode\s+otp|one[\s_-]?time\s+password)\b)\s*[:=#-]?\s*[0-9]{3,12}\b|\bcode\s+secret\b\s*[:=#-]\s*[a-z0-9]{3,12}\b/iu,
  ],
  [
    "ACCESS_SECRET_LABEL_V1",
    /(?:\b(?:password|passcode|passphrase|access[\s_-]?token|api[\s_-]?token|kata\s+sandi|contrase(?:ñ|n)a|mot\s+de\s+passe)\b)\s*[:=#-]?\s*[^\s,;]{4,128}/iu,
  ],
  [
    "BANK_ACCOUNT_LABEL_V1",
    /(?:\b(?:bank\s+account|account\s+(?:number|no)|nomor\s+rekening|no\.?\s*rekening|n[uú]mero\s+de\s+cuenta|num[eé]ro\s+de\s+compte|kontonummer)\b)\s*[:=#-]?\s*(?=(?:[a-z .-]*[0-9]){6})[a-z0-9][a-z0-9 .-]{5,33}/iu,
  ],
  [
    "ID_IDENTITY_LABEL_V1",
    /(?:\b(?:nik|ktp|passport|paspor|government[\s_-]?id|national[\s_-]?id)\b)\s*[:=#-]?\s*[a-z0-9][a-z0-9.-]{5,23}/iu,
  ],
  [
    "STATEMENT_SOLICITATION_V1",
    /\b(?:upload|attach|send|share|unggah|lampirkan|kirim)\b[^\n]{0,32}\b(?:bank\s+statement|rekening\s+koran|account\s+statement)\b/iu,
  ],
] as const;

function ephemeralNormalize(content: string): string {
  return content
    .normalize("NFKC")
    .replaceAll(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replaceAll(/[\t\r\f\v]+/gu, " ");
}

function validLuhn(candidate: string): boolean {
  const digits = candidate.replaceAll(/[^0-9]/gu, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function validIban(candidate: string): boolean {
  const compact = candidate.replaceAll(/[\s-]/gu, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{9,30}$/u.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function matchFamily(content: string): PrivacyRuleFamily | null {
  const normalized = ephemeralNormalize(content);
  for (const [family, pattern] of labeledRules) {
    if (pattern.test(normalized)) return family;
  }
  const panCandidates = normalized.match(/(?:\d[\s.-]?){13,19}/gu) ?? [];
  if (panCandidates.some(validLuhn)) return "PAN_LUHN_V1";
  const ibanCandidates =
    normalized.match(
      /(?:^|[^A-Z0-9])([A-Z]{2}[0-9]{2}(?:[\s-]?[A-Z0-9]){9,30})(?:$|[^A-Z0-9])/giu,
    ) ?? [];
  if (ibanCandidates.some(validIban)) return "IBAN_MOD97_V1";
  return null;
}

/** Finite, deterministic, best-effort detector. Result contains no candidate or span material. */
export function detectTextV1(content: string): DetectorV1Result {
  const family = matchFamily(content);
  return family === null
    ? { decision: "allow", matched: false, ruleFamily: null, warningCode: null }
    : {
        decision: "block_match",
        matched: true,
        ruleFamily: family,
        warningCode: "REMOVE_SENSITIVE_INFORMATION_OR_ABANDON_CAPTURE",
      };
}

export const detectorV1InternalsForTests = Object.freeze({ validIban, validLuhn });
