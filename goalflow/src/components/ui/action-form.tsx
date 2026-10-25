"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ActionResult } from "@/lib/validation/common";
import { buttonClass } from "./index";

type State = ActionResult<unknown> | null;
const FormCtx = createContext<State>(null);
const PendingCtx = createContext(false);

/**
 * Wraps a server action with pending state, field errors and a visible success/error message.
 * Server actions validate on the server; the form never trusts client-side checks.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
  showMessage = true,
  id,
}: {
  action: (prev: State, fd: FormData) => Promise<State>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (state: State) => void;
  showMessage?: boolean;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccessRef.current?.(state);
    }
  }, [state, resetOnSuccess]);
  return (
    <FormCtx.Provider value={state}>
      <PendingCtx.Provider value={pending}>
        {/* Dispatched manually so a failed submit keeps what the user typed (React resets forms
            submitted through the `action` prop). */}
        <form
          ref={ref}
          className={className}
          id={id}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
            startTransition(() => formAction(fd));
          }}
        >
          {children}
          {showMessage ? <FormMessage /> : null}
        </form>
      </PendingCtx.Provider>
    </FormCtx.Provider>
  );
}

export function useFormResult() {
  return useContext(FormCtx);
}

export function FormMessage() {
  const state = useContext(FormCtx);
  if (!state) return null;
  if (state.ok) {
    return state.message ? (
      <p role="status" className="mt-3 text-sm text-ok">
        {state.message}
      </p>
    ) : null;
  }
  return (
    <div role="alert" className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">
      <p>{state.error}</p>
      {state.fieldErrors && Object.keys(state.fieldErrors).length ? (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {Object.entries(state.fieldErrors).map(([k, v]) => (
            <li key={k}>
              {k.replace(/([A-Z])/g, " $1").toLowerCase()}: {v}
            </li>
          ))}
        </ul>
      ) : null}
      {state.conflicts?.length ? (
        <ul className="mt-1 list-disc pl-5">
          {state.conflicts.map((c, i) => (
            <li key={i}>
              {c.label}: {c.start} – {c.end}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function FieldError({ name }: { name: string }) {
  const state = useContext(FormCtx);
  const msg = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  if (!msg) return null;
  return (
    <p className="mt-1 text-xs text-danger" id={`${name}-error`}>
      {msg}
    </p>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  pendingText,
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
}) {
  const pending = useContext(PendingCtx);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
