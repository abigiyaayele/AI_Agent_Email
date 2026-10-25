export const metadata = { title: "Offline" };
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-sm text-muted">
        GoalFlow needs a connection to load your goals and tasks. Anything you were typing in a note is kept on this device and will save when you reconnect.
      </p>
      <a href="/today" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
        Try again
      </a>
    </main>
  );
}
