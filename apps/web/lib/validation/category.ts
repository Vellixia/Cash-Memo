import { z } from "zod";

const unicodeName = z.string().transform((value) => value.trim()).pipe(
  z.string().min(1, "Enter a category name.").refine((value) => Array.from(value).length <= 80, "Use 80 characters or fewer."),
);

export const categorySchema = z.object({
  name: unicodeName,
  kind: z.enum(["income", "expense"], { error: "Choose income or expense." }),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
