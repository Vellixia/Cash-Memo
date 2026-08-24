import { z } from "zod";

export const emailSchema = z.string().trim().pipe(z.email("Enter valid email"));
export const passwordSchema = z.string().min(12, "Use at least 12 characters");
export const credentialsSchema = z.object({ email: emailSchema, password: passwordSchema });
export const resetPasswordSchema = z.object({ password: passwordSchema, token: z.string().trim().min(1) });
