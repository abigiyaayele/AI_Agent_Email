import { LogOut } from "lucide-react";
import { MobileNav, Sidebar } from "@/components/app-nav";
import { buttonClass } from "@/components/ui";
import { logoutAction } from "@/server/actions/auth";
import { requireAuth } from "@/server/auth/session";
import { unreadCount } from "@/server/services/reminders";
import { activeSessions } from "@/server/services/timer";
import { ActiveTimers } from "@/components/timer/active-timer";
import { serializeSessions } from "@/server/services/timer-view";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAuth();
  const [unread, running] = await Promise.all([unreadCount(user.id), activeSessions(user.id)]);
  const footer = (
    <div className="mt-3 border-t border-border pt-3">
      <p className="truncate px-2.5 text-sm font-medium">{user.name || user.email}</p>
      <p className="truncate px-2.5 text-xs text-muted">{user.email}</p>
      <form action={logoutAction} className="mt-2">
        <button type="submit" className={buttonClass("ghost", "sm", "w-full justify-start")}>
          <LogOut size={14} /> Sign out
        </button>
      </form>
    </div>
  );
  return (
    <div className="lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface p-3 lg:block">
        <Sidebar unread={unread} footer={footer} />
      </aside>
      <MobileNav unread={unread} footer={footer} />
      <main id="main" className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 pt-4 pb-24 sm:px-6 lg:pt-6 lg:pb-10">
        {running.length ? (
          <div className="sticky top-12 z-20 -mx-1 mb-4 lg:top-2">
            <ActiveTimers sessions={serializeSessions(running)} serverNow={new Date().toISOString()} />
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
