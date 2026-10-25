import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getAuth()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-semibold tracking-tight">GoalFlow</p>
          <p className="text-sm text-muted">Turn long-term ambitions into daily action.</p>
        </div>
        {children}
      </div>
    </main>
  );
}
