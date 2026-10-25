import Link from "next/link";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Card, Field, Input } from "@/components/ui";
import { loginAction } from "@/server/actions/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <Card>
      <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
      <ActionForm action={loginAction} className="space-y-3">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
          <FieldError name="email" />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
          <FieldError name="password" />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted">
        New here?{" "}
        <Link className="text-accent underline" href="/register">
          Create an account
        </Link>
      </p>
    </Card>
  );
}
