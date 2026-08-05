export type BlockingDetectorId =
  | "B1_PAN_LUHN"
  | "B2_IBAN_MOD97"
  | "B3_LABELED_ACCOUNT"
  | "B4_LABELED_ROUTING"
  | "B5_LABELED_CARD_SECRET"
  | "B6_LABELED_BANK_CREDENTIAL"
  | "B7_LABELED_BANK_TOKEN"
  | "B8_STATEMENT_PASTE"
  | "B9_LABELED_GOV_ID";

export type WarningDetectorId =
  | "W1_BANKING_CONTEXT"
  | "W2_UNLABELED_LONG_NUMBER"
  | "W3_STATEMENT_HEADER";

export type PatternDecision =
  | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "block"; detectorId: BlockingDetectorId }>
  | Readonly<{ kind: "warn"; detectorId: WarningDetectorId }>;

const accountLabels = [
  "account number",
  "account no",
  "account #",
  "acct number",
  "acct no",
  "a/c no",
  "nomor rekening",
  "no rekening",
  "no. rekening",
] as const;
const statementHeaders = [
  "bank statement",
  "account statement",
  "rekening koran",
  "mutasi rekening",
] as const;

/** Synchronous finite v1 check. Normalized text remains local to this stack frame. */
export function detectPatternV1(original: string): PatternDecision {
  const value = preprocess(original);
  if (panLuhn(value)) return { kind: "block", detectorId: "B1_PAN_LUHN" };
  if (ibanMod97(value)) return { kind: "block", detectorId: "B2_IBAN_MOD97" };
  if (labeledAccount(value))
    return { kind: "block", detectorId: "B3_LABELED_ACCOUNT" };
  if (labeledRouting(value))
    return { kind: "block", detectorId: "B4_LABELED_ROUTING" };
  if (labeledCardSecret(value))
    return { kind: "block", detectorId: "B5_LABELED_CARD_SECRET" };
  if (labeledCredential(value))
    return { kind: "block", detectorId: "B6_LABELED_BANK_CREDENTIAL" };
  if (labeledToken(value))
    return { kind: "block", detectorId: "B7_LABELED_BANK_TOKEN" };
  if (statementPaste(value))
    return { kind: "block", detectorId: "B8_STATEMENT_PASTE" };
  if (labeledGovernmentId(value))
    return { kind: "block", detectorId: "B9_LABELED_GOV_ID" };
  if (statementHeader(value))
    return { kind: "warn", detectorId: "W3_STATEMENT_HEADER" };
  if (bankingContext(value))
    return { kind: "warn", detectorId: "W1_BANKING_CONTEXT" };
  if (
    digitCandidates(value).some(
      (digits) => digits.length >= 6 && digits.length <= 34,
    )
  )
    return { kind: "warn", detectorId: "W2_UNLABELED_LONG_NUMBER" };
  return { kind: "clear" };
}

function preprocess(value: string): string {
  return Array.from(
    value.replaceAll("\r\n", "\n").normalize("NFKC"),
    (character) => {
      const digit = unicodeDecimalDigit(character.codePointAt(0));
      if (digit !== undefined) return String(digit);
      const point = character.codePointAt(0);
      return point !== undefined && point >= 0x41 && point <= 0x5a
        ? String.fromCodePoint(point + 0x20)
        : character;
    },
  ).join("");
}

function unicodeDecimalDigit(point: number | undefined): number | undefined {
  if (point === undefined) return undefined;
  const starts = [
    0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66,
    0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040,
    0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0,
    0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0,
    0xff10, 0x104a0, 0x10d30, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0,
    0x11450, 0x114d0, 0x11650, 0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50,
    0x11d50, 0x11da0, 0x16a60, 0x16ac0, 0x16b50,
  ];
  for (const start of starts)
    if (point >= start && point <= start + 9) return point - start;
  if (point >= 0x1d7ce && point <= 0x1d7ff) return (point - 0x1d7ce) % 10;
  return undefined;
}

function digitCandidates(value: string): string[] {
  return value
    .split(/[^0-9 \t-]+/u)
    .map((candidate) => candidate.replaceAll(/[ \t-]/gu, ""))
    .filter(Boolean);
}

function panLuhn(value: string): boolean {
  return digitCandidates(value).some((digits) => {
    if (digits.length < 13 || digits.length > 19) return false;
    const sum = Array.from(digits)
      .reverse()
      .reduce((total, character, index) => {
        let digit = Number(character);
        if (index % 2 === 1) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        return total + digit;
      }, 0);
    return sum % 10 === 0;
  });
}

function ibanMod97(value: string): boolean {
  return value
    .split(/[^a-z0-9 \t-]+/u)
    .map((candidate) => candidate.replaceAll(/[ \t-]/gu, "").toUpperCase())
    .some((candidate) => {
      if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/u.test(candidate)) return false;
      let remainder = 0;
      for (const character of `${candidate.slice(4)}${candidate.slice(0, 4)}`) {
        const expanded = /[A-Z]/u.test(character)
          ? String(character.charCodeAt(0) - 55)
          : character;
        for (const digit of expanded)
          remainder = (remainder * 10 + Number(digit)) % 97;
      }
      return remainder === 1;
    });
}

function afterLabel(
  line: string,
  labels: readonly string[],
): string | undefined {
  for (const label of labels) {
    const index = line.indexOf(label);
    if (index < 0) continue;
    const tail = line.slice(index + label.length);
    const candidate = tail.replace(/^[\s:=#]*/u, "");
    if (Array.from(tail).length - Array.from(candidate).length <= 32)
      return candidate;
  }
  return undefined;
}

function compactPrefix(value: string, maximum: number): string {
  return (value.match(/^[a-z0-9 \t-]*/u)?.[0] ?? "")
    .replaceAll(/[ \t-]/gu, "")
    .slice(0, maximum + 1);
}

function labeledAccount(value: string): boolean {
  return value.split("\n").some((line) => {
    const tail = afterLabel(line, accountLabels);
    if (tail === undefined) return false;
    const candidate = compactPrefix(tail, 34);
    return candidate.length >= 6 && candidate.length <= 34;
  });
}

function labeledRouting(value: string): boolean {
  return value.split("\n").some((line) => {
    const aba = afterLabel(line, ["routing number", "routing no", "aba"]);
    if (aba !== undefined) {
      const digits = compactPrefix(aba, 9);
      if (/^[0-9]{9}$/u.test(digits)) {
        const d = Array.from(digits, Number);
        const checksum =
          3 * ((d[0] ?? 0) + (d[3] ?? 0) + (d[6] ?? 0)) +
          7 * ((d[1] ?? 0) + (d[4] ?? 0) + (d[7] ?? 0)) +
          (d[2] ?? 0) +
          (d[5] ?? 0) +
          (d[8] ?? 0);
        if (checksum % 10 === 0) return true;
      }
    }
    const local = afterLabel(line, ["sort code", "bsb"]);
    return local !== undefined && /^[0-9]{6}$/u.test(compactPrefix(local, 6));
  });
}

function labeledCardSecret(value: string): boolean {
  const labels = [
    "cvv",
    "cvc",
    "cid",
    "card verification code",
    "card security code",
    "kode keamanan kartu",
  ];
  return value.split("\n").some((line) => {
    const tail = afterLabel(line, labels);
    return tail !== undefined && /^[0-9]{3,4}(?:\D|$)/u.test(tail);
  });
}

function labeledCredential(value: string): boolean {
  const labels = [
    "bank password",
    "banking password",
    "online banking password",
    "internet banking password",
    "bank pin",
    "atm pin",
    "mobile banking pin",
    "m-banking pin",
    "password bank",
    "pin bank",
  ];
  return value.split("\n").some((line) => {
    const token = afterLabel(line, labels)?.match(/^\S{4,128}(?:\s|$)/u)?.[0];
    return token !== undefined;
  });
}

function labeledToken(value: string): boolean {
  const labels = [
    "bank access token",
    "banking access token",
    "bank refresh token",
    "banking token",
    "mobile banking token",
    "internet banking token",
    "bank otp",
    "banking otp",
    "bank tac",
  ];
  return value.split("\n").some((line) => {
    const tail = afterLabel(line, labels);
    return (
      tail !== undefined &&
      /^[a-z0-9._~+/=-]{6,512}(?:[^a-z0-9._~+/=-]|$)/u.test(tail)
    );
  });
}

function statementHeader(value: string): boolean {
  return statementHeaders.some((header) => value.includes(header));
}

function statementPaste(value: string): boolean {
  const lines = value.split("\n");
  const headerIndex = lines.findIndex((line) =>
    statementHeaders.some((header) => line.includes(header)),
  );
  if (headerIndex < 0) return false;
  const markers = [
    "account number",
    "nomor rekening",
    "statement period",
    "periode",
    "opening balance",
    "saldo awal",
    "closing balance",
    "saldo akhir",
    "transaction date",
    "tanggal transaksi",
    "debit",
    "credit",
  ];
  if (markers.filter((marker) => value.includes(marker)).length < 2)
    return false;
  const date =
    /(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}\/[0-9]{2}\/[0-9]{4}|[0-9]{2}-[0-9]{2}-[0-9]{4})/u;
  return (
    lines.slice(headerIndex + 1).filter((line) => {
      const match = date.exec(line);
      if (match === null) return false;
      const withoutDate = `${line.slice(0, match.index)} ${line.slice(match.index + match[0].length)}`;
      return /(?:^|[^a-z0-9])[0-9]+(?:[.,][0-9]+)?(?:$|[^a-z0-9])/u.test(
        withoutDate,
      );
    }).length >= 3
  );
}

function labeledGovernmentId(value: string): boolean {
  return value.split("\n").some((line) => {
    const ssn = afterLabel(line, ["ssn", "social security number"]);
    if (ssn !== undefined && /[0-9]{3}-[0-9]{2}-[0-9]{4}/u.test(ssn))
      return true;
    const nik = afterLabel(line, ["nik", "nomor induk kependudukan"]);
    if (nik !== undefined && /^[0-9]{16}(?:\D|$)/u.test(nik)) return true;
    const general = afterLabel(line, [
      "government id",
      "national id",
      "identity number",
    ]);
    if (general === undefined) return false;
    const compact = compactPrefix(general, 24);
    return compact.length >= 6 && compact.length <= 24;
  });
}

function bankingContext(value: string): boolean {
  return [
    "bank account",
    "card number",
    "bank statement",
    "bank token",
    "bank password",
    "rekening",
    "kartu kredit",
    "kartu debit",
  ].some((phrase) => value.includes(phrase));
}
