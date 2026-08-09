import type { CurrencyRegistry } from "@cashmemo/currency-registry";

const MAX_SIGNED_64 = 9_223_372_036_854_775_807n;
const decimalPattern = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;
const minorPattern = /^(?:0|[1-9][0-9]*)$/u;
const currencyPattern = /^[A-Z]{3}$/u;

type MoneyValidationCode =
  | "AMOUNT_GRAMMAR_INVALID"
  | "AMOUNT_MUST_BE_POSITIVE"
  | "AMOUNT_MUST_BE_STRING"
  | "AMOUNT_OUT_OF_RANGE"
  | "AMOUNT_PRECISION_EXCEEDED"
  | "AMOUNT_SIGNIFICANT_DIGITS_EXCEEDED"
  | "CURRENCY_UNSUPPORTED"
  | "MONEY_SNAPSHOT_INVALID";

class MoneyValidationError extends Error {
  readonly code: MoneyValidationCode;

  constructor(code: MoneyValidationCode) {
    super(`Money validation failed (${code}).`);
    this.name = "MoneyValidationError";
    this.code = code;
  }
}

interface MoneyInput {
  readonly amount: unknown;
  readonly currency: unknown;
}

interface MoneySnapshot {
  readonly amountMinor: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly currencyRegistryVersion: string;
}

interface SerializedMoney extends MoneySnapshot {
  readonly amount: string;
}

interface CurrencyPartition {
  readonly amountMinor: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly currencyRegistryVersion: string;
}

class Money {
  readonly currency: string;
  readonly currencyExponent: number;
  readonly currencyRegistryVersion: string;
  readonly #amountMinor: bigint;

  private constructor(snapshot: MoneySnapshot, amountMinor: bigint) {
    this.currency = snapshot.currency;
    this.currencyExponent = snapshot.currencyExponent;
    this.currencyRegistryVersion = snapshot.currencyRegistryVersion;
    this.#amountMinor = amountMinor;
    Object.freeze(this);
  }

  static fromMinor(snapshot: MoneySnapshot): Money {
    if (
      !minorPattern.test(snapshot.amountMinor) ||
      !currencyPattern.test(snapshot.currency) ||
      !Number.isInteger(snapshot.currencyExponent) ||
      snapshot.currencyExponent < 0 ||
      snapshot.currencyExponent > 3 ||
      snapshot.currencyRegistryVersion.length === 0
    ) {
      throw new MoneyValidationError("MONEY_SNAPSHOT_INVALID");
    }
    const amountMinor = BigInt(snapshot.amountMinor);
    if (amountMinor <= 0n) throw new MoneyValidationError("AMOUNT_MUST_BE_POSITIVE");
    if (amountMinor > MAX_SIGNED_64) throw new MoneyValidationError("AMOUNT_OUT_OF_RANGE");
    return new Money(snapshot, amountMinor);
  }

  toMinorUnits(): bigint {
    return this.#amountMinor;
  }
}

function parseMoney(input: MoneyInput, registry: CurrencyRegistry): Money {
  if (typeof input.amount !== "string") {
    throw new MoneyValidationError("AMOUNT_MUST_BE_STRING");
  }
  if (typeof input.currency !== "string") {
    throw new MoneyValidationError("CURRENCY_UNSUPPORTED");
  }
  const currency = registry.get(input.currency);
  if (currency === undefined) throw new MoneyValidationError("CURRENCY_UNSUPPORTED");

  const match = decimalPattern.exec(input.amount);
  if (match === null) throw new MoneyValidationError("AMOUNT_GRAMMAR_INVALID");
  const integerDigits = match[1];
  const fractionDigits = match[2] ?? "";
  if (integerDigits === undefined) throw new MoneyValidationError("AMOUNT_GRAMMAR_INVALID");
  if (fractionDigits.length > currency.exponent) {
    throw new MoneyValidationError("AMOUNT_PRECISION_EXCEEDED");
  }
  const significantDigits = `${integerDigits}${fractionDigits}`.replace(/^0+/u, "").length;
  if (significantDigits === 0) throw new MoneyValidationError("AMOUNT_MUST_BE_POSITIVE");
  if (significantDigits > 15) {
    throw new MoneyValidationError("AMOUNT_SIGNIFICANT_DIGITS_EXCEEDED");
  }

  const amountMinor = BigInt(`${integerDigits}${fractionDigits.padEnd(currency.exponent, "0")}`);
  if (amountMinor <= 0n) throw new MoneyValidationError("AMOUNT_MUST_BE_POSITIVE");
  if (amountMinor > MAX_SIGNED_64) throw new MoneyValidationError("AMOUNT_OUT_OF_RANGE");

  return Money.fromMinor({
    amountMinor: amountMinor.toString(),
    currency: currency.code,
    currencyExponent: currency.exponent,
    currencyRegistryVersion: registry.version,
  });
}

function serializeMoney(money: Money): SerializedMoney {
  const amountMinor = money.toMinorUnits();
  return Object.freeze({
    amount: decimalFromMinor(amountMinor, money.currencyExponent),
    amountMinor: amountMinor.toString(),
    currency: money.currency,
    currencyExponent: money.currencyExponent,
    currencyRegistryVersion: money.currencyRegistryVersion,
  });
}

function decimalFromMinor(amountMinor: bigint, exponent: number): string {
  const digits = amountMinor.toString().padStart(exponent + 1, "0");
  if (exponent === 0) return digits;
  const integerDigits = digits.slice(0, -exponent);
  const fractionDigits = digits.slice(-exponent).replace(/0+$/u, "");
  return fractionDigits.length === 0 ? integerDigits : `${integerDigits}.${fractionDigits}`;
}

function sumMoneyByCurrency(values: readonly Money[]): readonly CurrencyPartition[] {
  const partitions = new Map<
    string,
    { amountMinor: bigint; currency: string; exponent: number; registryVersion: string }
  >();
  for (const money of values) {
    const key = `${money.currency}:${String(money.currencyExponent)}:${money.currencyRegistryVersion}`;
    const current = partitions.get(key);
    if (current === undefined) {
      partitions.set(key, {
        amountMinor: money.toMinorUnits(),
        currency: money.currency,
        exponent: money.currencyExponent,
        registryVersion: money.currencyRegistryVersion,
      });
    } else {
      current.amountMinor += money.toMinorUnits();
    }
  }

  return Object.freeze(
    [...partitions.values()]
      .sort(
        (left, right) =>
          left.currency.localeCompare(right.currency) ||
          left.exponent - right.exponent ||
          left.registryVersion.localeCompare(right.registryVersion),
      )
      .map((partition) =>
        Object.freeze({
          amountMinor: partition.amountMinor.toString(),
          currency: partition.currency,
          currencyExponent: partition.exponent,
          currencyRegistryVersion: partition.registryVersion,
        }),
      ),
  );
}

export {
  Money,
  MoneyValidationError,
  parseMoney,
  serializeMoney,
  sumMoneyByCurrency,
  type CurrencyPartition,
  type MoneyInput,
  type MoneySnapshot,
  type MoneyValidationCode,
  type SerializedMoney,
};
