import { z } from "zod";

const unicodeName = z.string().transform((value) => value.trim()).pipe(
  z.string().min(1, "Enter a wallet name.").refine((value) => Array.from(value).length <= 80, "Use 80 characters or fewer."),
);

export const walletSchema = z.object({
  name: unicodeName,
  currency: z.string().trim().min(1, "Choose a currency."),
  opening_balance: z.string().trim().min(1, "Enter an opening balance."),
});

export type WalletFormValues = z.infer<typeof walletSchema>;
