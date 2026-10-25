export function SetupRequired({ issues }: { issues: string[] }) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">GoalFlow needs configuration</h1>
      <p className="mt-2 text-muted">The server started without required settings:</p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
        {issues.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <p className="mt-4 text-sm">
        Copy <code>.env.example</code> to <code>.env</code>, set <code>DATABASE_URL</code>, run <code>npm run db:migrate</code> and
        restart. See <code>docs/SETUP.md</code>.
      </p>
    </main>
  );
}
