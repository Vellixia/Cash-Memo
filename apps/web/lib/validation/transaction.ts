import { z } from "zod";

function amountFor(exponent: number) {
  const safeExponent = Number.isInteger(exponent) && exponent >= 0 ? exponent : 2;
  const decimal = safeExponent === 0 ? "" : `(?:\\.\\d{1,${String(safeExponent)}})?`;
  return new RegExp(`^(?:0|[1-9]\\d*)${decimal}$`);
}

export function transactionSchema(exponent = 2) {
  return z.object({
    amount: z
      .string()
      .trim()
      .min(1, "Enter an amount.")
      .refine(
        (value) => amountFor(exponent).test(value),
        `Use no more than ${String(exponent)} decimal ${exponent === 1 ? "place" : "places"}.`,
      ),
    wallet_id: z.string().min(1, "Choose a wallet."),
    category_id: z.string().min(1, "Choose a category."),
    direction: z.enum(["expense", "income"]),
    note: z
      .string()
      .refine((value) => Array.from(value).length <= 500, "Use 500 characters or fewer."),
    occurred_at: z.string().min(1, "Choose date and time."),
  });
}

export type TransactionFormValues = z.infer<ReturnType<typeof transactionSchema>>;
