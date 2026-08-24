"use client";

import Link from "next/link";
import { RegisterForm } from "../../../features/auth/forms";

export default function RegisterPage() { return <div className="public-page"><RegisterForm /><p className="auth-links"><Link href="/login">Already have an account?</Link></p></div>; }
