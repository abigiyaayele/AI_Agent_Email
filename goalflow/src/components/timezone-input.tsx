"use client";

import { useEffect, useState } from "react";

/** Hidden field carrying the browser's IANA time zone so reminders start in the right zone. */
export function TimezoneInput() {
  const [tz, setTz] = useState("UTC");
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      /* keep UTC */
    }
  }, []);
  return <input type="hidden" name="timezone" value={tz} />;
}
