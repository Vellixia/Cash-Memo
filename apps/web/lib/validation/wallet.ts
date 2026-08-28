import { z } from "zod";

const unicodeName = z.string().transform((value) => value.trim()).pipe(
  z.string().min(1, "Enter a wallet name.").refine((value) => Array.from(value).length <= 80, "Use 80 characters or fewer."),
);

export function walletSchema(exponent?: number) {
  const openingBalance = z.string().trim().min(1, "Enter an opening balance.").refine((value) => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
    if (exponent === undefined) return true;
    const fraction = value.split(".")[1]?.replace(/0+$/, "") ?? "";
    return fraction.length <= exponent;
  }, exponent === undefined ? "Enter a non-negative decimal amount." : `Enter a non-negative amount with up to ${String(exponent)} decimal places.`);
  return z.object({
    name: unicodeName,
    currency: z.string().trim().min(1, "Choose a currency."),
    opening_balance: openingBalance,
  });
}

export type WalletFormValues = z.infer<ReturnType<typeof walletSchema>>;
