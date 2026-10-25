"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button, buttonClass } from "./index";

/** Accessible modal built on the native <dialog> element (focus trapping and Esc for free). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className={`m-auto w-[calc(100%-1.5rem)] ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl border border-border bg-surface p-0 text-fg shadow-xl`}
    >
      {open ? (
        <div className="max-h-[85dvh] overflow-y-auto p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className={buttonClass("ghost", "sm")} aria-label="Close dialog">
              <X size={16} />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** Button that asks for confirmation before running a destructive action. */
export function ConfirmButton({
  onConfirm,
  children,
  title = "Are you sure?",
  description,
  confirmLabel = "Delete",
  variant = "danger",
  size = "sm",
}: {
  onConfirm: () => Promise<unknown> | void;
  children: ReactNode;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: "danger" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant={variant === "danger" ? "ghost" : variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        {description ? <div className="text-sm text-muted">{description}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await onConfirm();
                setOpen(false);
              })
            }
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
