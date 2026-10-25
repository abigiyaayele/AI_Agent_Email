import { Card, LinkButton, PageHeader } from "@/components/ui";
import { requireAuth } from "@/server/auth/session";
import { nowIn } from "@/lib/domain/periods";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user, prefs } = await requireAuth();
  const now = nowIn(prefs.timezone);
  return (
    <div className="space-y-5">
      <PageHeader title={`Good ${now.hour < 12 ? "morning" : now.hour < 18 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`} subtitle={now.toFormat("cccc, d LLLL yyyy")} />
      {!prefs.onboarded ? (
        <Card>
          <p className="font-medium">Finish setting up</p>
          <p className="mt-1 text-sm text-muted">Confirm your working hours so GoalFlow can calculate realistic plans.</p>
          <LinkButton className="mt-3" variant="primary" href="/settings">
            Open settings
          </LinkButton>
        </Card>
      ) : null}
    </div>
  );
}
