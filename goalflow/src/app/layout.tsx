import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getAuth } from "@/server/auth/session";
import { env, MissingConfigError } from "@/lib/env";
import { SetupRequired } from "@/components/setup-required";

export const metadata: Metadata = {
  title: { default: "GoalFlow", template: "%s · GoalFlow" },
  description: "Turn long-term ambitions into daily action.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GoalFlow", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#141513" },
  ],
};

// Resolves "system" theme before paint to avoid a flash.
const themeScript = `(function(){try{var t=document.documentElement.dataset.pref||'system';if(t==='system'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

async function themePreference(): Promise<string> {
  try {
    return (await getAuth())?.prefs.theme ?? "system";
  } catch {
    // Database unreachable or not configured: fall back to the system theme.
    return "system";
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let configIssues: string[] | null = null;
  try {
    env();
  } catch (err) {
    configIssues = err instanceof MissingConfigError ? err.issues : [String(err)];
  }
  const pref = configIssues ? "system" : await themePreference();
  return (
    <html lang="en" data-pref={pref} data-theme={pref === "dark" ? "dark" : "light"} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{configIssues ? <SetupRequired issues={configIssues} /> : children}</body>
    </html>
  );
}
