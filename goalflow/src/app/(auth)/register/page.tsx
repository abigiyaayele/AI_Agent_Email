import Link from "next/link";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Card, Field, Input } from "@/components/ui";
import { TimezoneInput } from "@/components/timezone-input";
import { registerAction } from "@/server/actions/auth";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <Card>
      <h1 className="mb-4 text-lg font-semibold">Create your account</h1>
      <ActionForm action={registerAction} className="space-y-3">
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
          <FieldError name="name" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
          <FieldError name="email" />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          <FieldError name="password" />
        </Field>
        <TimezoneInput />
        <SubmitButton className="w-full" pendingText="Creating account…">
          Create account
        </SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link className="text-accent underline" href="/login">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
