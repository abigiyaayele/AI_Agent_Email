import { PageHeader } from "@/components/ui";
import { features } from "@/lib/env";
import { periodContaining, todayIn } from "@/lib/domain/periods";
import { requireAuth } from "@/server/auth/session";
import { PlanWizard } from "./wizard";

export const metadata = { title: "Plan a yearly goal" };

export default async function PlanPage() {
  const { prefs } = await requireAuth();
  const today = todayIn(prefs.timezone);
  const yearEnd = periodContaining("year", today, prefs.timezone).end;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Plan a yearly goal"
        subtitle="Define the outcome, make it measurable, then review a proposed breakdown before anything is saved."
      />
      <PlanWizard today={today} yearEnd={yearEnd} aiEnabled={features().ai} />
    </div>
  );
}
