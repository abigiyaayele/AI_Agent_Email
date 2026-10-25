import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select, buttonClass } from "@/components/ui";
import { WEEKDAYS } from "@/lib/format";
import { features } from "@/lib/env";
import { requireAuth } from "@/server/auth/session";
import { listSchedules } from "@/server/services/account";
import {
  addScheduleAction,
  changePasswordAction,
  deleteAccountAction,
  savePreferencesAction,
  saveProfileAction,
} from "@/server/actions/settings";
import { ScheduleList } from "./schedule-list";
import { PushToggle } from "@/components/push-toggle";

export const metadata = { title: "Settings" };

function DayChecks({ name, selected }: { name: string; selected: number[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAYS.map((d) => (
        <label key={d.value} className="flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
          <input type="checkbox" name={`${name}[]`} value={d.value} defaultChecked={selected.includes(d.value)} className="accent-[var(--accent)]" />
          {d.short}
        </label>
      ))}
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { user, prefs } = await requireAuth();
  const { welcome } = await searchParams;
  const schedules = await listSchedules(user.id);
  const zones = Intl.supportedValuesOf("timeZone");
  const f = features();

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Your availability drives scheduling, pacing and overload warnings." />
      {welcome ? (
        <div className="rounded-xl border border-accent bg-accent-soft p-4 text-sm">
          <p className="font-medium">Welcome to GoalFlow, {user.name}.</p>
          <p className="mt-1">
            Start by confirming your working hours and recurring commitments below. Then create your first yearly goal from
            the Goal Hierarchy page.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Planning availability" subtitle="Used to calculate required pace and detect overload." />
        <ActionForm action={savePreferencesAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Time zone" htmlFor="timezone" hint="All times are shown in this zone.">
              <Input id="timezone" name="timezone" list="tz-list" defaultValue={prefs.timezone} />
              <datalist id="tz-list">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <FieldError name="timezone" />
            </Field>
            <Field label="Week starts on" htmlFor="weekStartsOn">
              <Select id="weekStartsOn" name="weekStartsOn" defaultValue={prefs.weekStartsOn}>
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.long}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Theme" htmlFor="theme">
              <Select id="theme" name="theme" defaultValue={prefs.theme}>
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
          </div>
          <Field label="Working days">
            <DayChecks name="workingDays" selected={prefs.workingDays} />
            <FieldError name="workingDays" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Available hours / working day" htmlFor="availableHoursPerDay" hint="Time you can give to goals.">
              <Input id="availableHoursPerDay" name="availableHoursPerDay" type="number" step="0.25" min="0" max="24" defaultValue={prefs.availableHoursPerDay} />
              <FieldError name="availableHoursPerDay" />
            </Field>
            <Field label="Maximum daily workload (h)" htmlFor="maxDailyHours">
              <Input id="maxDailyHours" name="maxDailyHours" type="number" step="0.25" min="0" max="24" defaultValue={prefs.maxDailyHours} />
              <FieldError name="maxDailyHours" />
            </Field>
            <Field label="Preferred start" htmlFor="preferredStart">
              <Input id="preferredStart" name="preferredStart" type="time" defaultValue={prefs.preferredStart} />
              <FieldError name="preferredStart" />
            </Field>
            <Field label="Preferred end" htmlFor="preferredEnd">
              <Input id="preferredEnd" name="preferredEnd" type="time" defaultValue={prefs.preferredEnd} />
              <FieldError name="preferredEnd" />
            </Field>
            <Field label="Sleep from" htmlFor="sleepStart">
              <Input id="sleepStart" name="sleepStart" type="time" defaultValue={prefs.sleepStart} />
            </Field>
            <Field label="Sleep until" htmlFor="sleepEnd">
              <Input id="sleepEnd" name="sleepEnd" type="time" defaultValue={prefs.sleepEnd} />
            </Field>
            <Field label="Personal time (h/day)" htmlFor="personalHoursPerDay">
              <Input id="personalHoursPerDay" name="personalHoursPerDay" type="number" step="0.25" min="0" max="24" defaultValue={prefs.personalHoursPerDay} />
            </Field>
            <Field label="Buffer between tasks (min)" htmlFor="bufferMinutes">
              <Input id="bufferMinutes" name="bufferMinutes" type="number" min="0" max="240" defaultValue={prefs.bufferMinutes} />
            </Field>
            <Field label="Break length (min)" htmlFor="breakMinutes">
              <Input id="breakMinutes" name="breakMinutes" type="number" min="0" max="240" defaultValue={prefs.breakMinutes} />
            </Field>
            <Field label="Pomodoro focus (min)" htmlFor="pomodoroFocusMinutes">
              <Input id="pomodoroFocusMinutes" name="pomodoroFocusMinutes" type="number" min="5" max="180" defaultValue={prefs.pomodoroFocusMinutes} />
            </Field>
            <Field label="Pomodoro break (min)" htmlFor="pomodoroBreakMinutes">
              <Input id="pomodoroBreakMinutes" name="pomodoroBreakMinutes" type="number" min="1" max="60" defaultValue={prefs.pomodoroBreakMinutes} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allowParallelTimers" defaultChecked={prefs.allowParallelTimers} />
            Allow more than one focus timer to run at the same time
          </label>

          <div className="border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-semibold">Reminders</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Daily planning reminder" htmlFor="dailyPlanTime">
                <Input id="dailyPlanTime" name="dailyPlanTime" type="time" defaultValue={prefs.dailyPlanTime} />
              </Field>
              <Field label="Review reminder time" htmlFor="dailyReviewTime" hint="Used for daily and period reviews.">
                <Input id="dailyReviewTime" name="dailyReviewTime" type="time" defaultValue={prefs.dailyReviewTime} />
              </Field>
              <Field label="Weekly review day" htmlFor="weeklyReviewDay">
                <Select id="weeklyReviewDay" name="weeklyReviewDay" defaultValue={prefs.weeklyReviewDay}>
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.long}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <fieldset className="mt-3">
              <legend className="mb-1 text-sm font-medium">Default channels for new reminders</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {(["in_app", "push", "email"] as const).map((c) => (
                  <label key={c} className="flex items-center gap-1.5">
                    <input type="checkbox" name="defaultChannels[]" value={c} defaultChecked={prefs.defaultChannels.includes(c)} />
                    {c === "in_app" ? "In-app" : c === "push" ? "Push / browser" : "Email"}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="emailReminders" defaultChecked={prefs.emailReminders} />
              Send email reminders {f.email ? null : <Badge tone="warn">email provider not configured on server</Badge>}
            </label>
          </div>
          <SubmitButton>Save settings</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Notifications on this device" subtitle="Browser and push notifications need your permission per device." />
        <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} pushConfigured={f.push} />
        <p className="mt-3 text-xs text-muted">
          Delivery note: in-app notifications are always stored. Browser notifications appear while GoalFlow is open. Push
          notifications can arrive when the browser is closed only if the server has VAPID keys and a scheduler runs; even
          then delivery depends on the device and OS and is not guaranteed. Use email for a second channel.
        </p>
      </Card>

      <Card>
        <CardHeader title="Recurring commitments" subtitle="Classes, meetings, gym... Tasks are checked against these for conflicts." />
        <ScheduleList items={schedules.map((s) => ({ id: s.id, label: s.label, days: s.days, startTime: s.startTime, endTime: s.endTime, kind: s.kind }))} />
        <ActionForm action={addScheduleAction} resetOnSuccess className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Name" htmlFor="label" className="sm:col-span-2">
              <Input id="label" name="label" placeholder="e.g. Evening class" />
              <FieldError name="label" />
            </Field>
            <Field label="From" htmlFor="startTime">
              <Input id="startTime" name="startTime" type="time" defaultValue="18:00" />
              <FieldError name="startTime" />
            </Field>
            <Field label="To" htmlFor="endTime">
              <Input id="endTime" name="endTime" type="time" defaultValue="19:00" />
              <FieldError name="endTime" />
            </Field>
          </div>
          <Field label="Repeats on">
            <DayChecks name="days" selected={[]} />
            <FieldError name="days" />
          </Field>
          <SubmitButton variant="secondary">Add commitment</SubmitButton>
        </ActionForm>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <ActionForm action={saveProfileAction} className="space-y-3">
            <Field label="Name" htmlFor="profile-name">
              <Input id="profile-name" name="name" defaultValue={user.name} />
              <FieldError name="name" />
            </Field>
            <p className="text-sm text-muted">Email: {user.email}</p>
            <SubmitButton variant="secondary">Save profile</SubmitButton>
          </ActionForm>
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-3">
            <Field label="Current password" htmlFor="current">
              <Input id="current" name="current" type="password" autoComplete="current-password" />
              <FieldError name="current" />
            </Field>
            <Field label="New password" htmlFor="next">
              <Input id="next" name="next" type="password" autoComplete="new-password" />
              <FieldError name="next" />
            </Field>
            <SubmitButton variant="secondary">Change password</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card>
        <CardHeader title="Your data" subtitle="Export everything as JSON at any time. Keep exports somewhere safe; they contain your notes." />
        <a className={buttonClass("secondary")} href="/api/export" download>
          Download export (JSON)
        </a>
        <details className="mt-5 rounded-lg border border-danger/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-danger">Delete account</summary>
          <p className="mt-2 text-sm text-muted">
            This permanently deletes your account and every goal, task, session, note and review. It cannot be undone.
            Download an export first if you want a copy.
          </p>
          <ActionForm action={deleteAccountAction} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <Field label="Password" htmlFor="del-password">
              <Input id="del-password" name="password" type="password" autoComplete="current-password" />
              <FieldError name="password" />
            </Field>
            <Field label='Type "DELETE"' htmlFor="confirm">
              <Input id="confirm" name="confirm" autoComplete="off" />
              <FieldError name="confirm" />
            </Field>
            <SubmitButton variant="danger" pendingText="Deleting…">
              Delete my account
            </SubmitButton>
          </ActionForm>
        </details>
      </Card>
    </div>
  );
}
