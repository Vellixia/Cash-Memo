import { z } from "zod";

export const emailValueSchema = z.string().trim().pipe(z.email("Enter valid email"));
export const emailSchema = z.object({ email: emailValueSchema });
export const passwordSchema = z.string().min(12, "Use at least 12 characters");
export const credentialsSchema = z.object({ email: emailValueSchema, password: passwordSchema });
export const newPasswordSchema = z.object({ password: passwordSchema });
export const resetPasswordSchema = z.object({ password: passwordSchema, token: z.string().trim().min(1) });
