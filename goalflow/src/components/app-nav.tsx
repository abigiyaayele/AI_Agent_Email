"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CalendarRange,
  Clock,
  LayoutDashboard,
  ListTodo,
  Menu,
  Network,
  Settings,
  Sparkles,
  Sun,
  Target,
  X,
} from "lucide-react";
import { cn } from "@/components/ui";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/today", label: "My Day", icon: Sun },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/tasks", label: "All Tasks", icon: ListTodo },
  { href: "/goals", label: "Goal Hierarchy", icon: Network },
  { href: "/plan/week", label: "Weekly Planning", icon: CalendarRange },
  { href: "/plan/month", label: "Monthly Planning", icon: CalendarRange },
  { href: "/plan/quarter", label: "Quarterly Planning", icon: CalendarRange },
  { href: "/plan/half", label: "Six-Month Planning", icon: CalendarRange },
  { href: "/plan/year", label: "Yearly Planning", icon: Target },
  { href: "/notes", label: "Notes & Journal", icon: BookOpen },
  { href: "/time", label: "Timesheet", icon: Clock },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const MOBILE = ["/dashboard", "/today", "/calendar", "/tasks", "/goals"];

function isActive(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

function NavLinks({ path, unread, onNavigate }: { path: string; unread: number; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <Link
            href={href}
            onClick={onNavigate}
            aria-current={isActive(path, href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm",
              isActive(path, href) ? "bg-accent-soft font-medium text-accent" : "text-fg/80 hover:bg-surface-2",
            )}
          >
            <Icon size={16} aria-hidden />
            <span className="flex-1">{label}</span>
            {href === "/notifications" && unread > 0 ? (
              <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg">
                {unread}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ unread, footer }: { unread: number; footer?: React.ReactNode }) {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <Link href="/dashboard" className="mb-4 px-2.5 text-lg font-semibold tracking-tight">
        GoalFlow
      </Link>
      <div className="flex-1 overflow-y-auto">
        <NavLinks path={path} unread={unread} />
      </div>
      {footer}
    </nav>
  );
}

export function MobileNav({ unread, footer }: { unread: number; footer?: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface/95 px-3 backdrop-blur lg:hidden">
        <button type="button" className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Link href="/dashboard" className="font-semibold">
          GoalFlow
        </Link>
        <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-surface-2" aria-label={`Notifications, ${unread} unread`}>
          <Bell size={20} />
          {unread > 0 ? <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent" /> : null}
        </Link>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface p-3 shadow-xl">
            <div className="mb-2 flex justify-end">
              <button type="button" className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Close menu">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks path={path} unread={unread} onNavigate={() => setOpen(false)} />
            </div>
            {footer}
          </div>
        </div>
      ) : null}
      <nav
        aria-label="Quick"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV.filter((n) => MOBILE.includes(n.href)).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive(path, href) ? "text-accent" : "text-muted")}
          >
            <Icon size={20} aria-hidden />
            {label.replace("Goal Hierarchy", "Goals").replace("All Tasks", "Tasks")}
          </Link>
        ))}
      </nav>
    </>
  );
}
