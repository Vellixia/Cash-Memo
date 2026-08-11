import type {
  PrivacyBoundaryEvaluation,
  PrivacyBoundaryPort,
  PrivacyBoundaryResult,
  PrivacyRuleFamily,
} from "./contracts.js";

const labeledRules: readonly [PrivacyRuleFamily, RegExp][] = [
  ["CARD_SECRET_LABEL_V1", /\b(?:cvv|cvc|pin|otp)\b\s*[:=#-]?\s*[a-z0-9]{3,8}\b/iu],
  [
    "ACCESS_SECRET_LABEL_V1",
    /\b(?:password|passcode|access[\s_-]?token|api[\s_-]?token)\b\s*[:=#-]?\s*[^\s]{4,128}/iu,
  ],
  [
    "BANK_ACCOUNT_LABEL_V1",
    /\b(?:bank\s+account|account\s+number|nomor\s+rekening|no\.?\s*rekening)\b\s*[:=#-]?\s*[a-z0-9 -]{6,34}/iu,
  ],
  [
    "ID_IDENTITY_LABEL_V1",
    /\b(?:nik|ktp|passport|government[\s_-]?id)\b\s*[:=#-]?\s*[a-z0-9-]{6,24}/iu,
  ],
];

function luhn(candidate: string): boolean {
  const digits = candidate.replaceAll(/[^0-9]/gu, "");
  if (digits.length < 13 || digits.length > 19) return false;
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

function iban(candidate: string): boolean {
  const compact = candidate.replaceAll(/\s/gu, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{9,30}$/u.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function matchRule(content: string): PrivacyRuleFamily | null {
  const normalized = content.normalize("NFKC");
  for (const [family, pattern] of labeledRules) {
    if (pattern.test(normalized)) return family;
  }
  const panCandidates = normalized.match(/(?:\d[ -]?){13,19}/gu) ?? [];
  if (panCandidates.some(luhn)) return "PAN_LUHN_V1";
  const ibanCandidates = normalized.match(/\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]){9,30}\b/giu) ?? [];
  if (ibanCandidates.some(iban)) return "IBAN_MOD97_V1";
  return null;
}

export class FinitePrivacyBoundary implements PrivacyBoundaryPort {
  evaluateText(evaluation: PrivacyBoundaryEvaluation): Promise<PrivacyBoundaryResult> {
    const family = matchRule(evaluation.content);
    return Promise.resolve(
      family === null
        ? { decision: "allow", matched: false, ruleFamily: null, warningCode: null }
        : {
            decision: "block_match",
            matched: true,
            ruleFamily: family,
            warningCode: "REMOVE_SENSITIVE_INFORMATION_OR_ABANDON_CAPTURE",
          },
    );
  }
}
