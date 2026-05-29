import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LogoTile } from "@/components/logo";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in · Stride" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const sp = await searchParams;
  if (await getSession()) redirect(sp.from || "/");

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-paper-0 px-6">
      {/* ambient gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, var(--accent-soft), transparent 70%), radial-gradient(40% 35% at 80% 100%, var(--accent-soft), transparent 70%)",
        }}
      />

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <LogoTile className="mx-auto mb-4 h-12 w-12 rounded-2xl shadow-card dark:shadow-card-dark" />

          <h1 className="text-3xl font-semibold tracking-tight text-ink-0">
            Stride
          </h1>
          <p className="mt-2 text-sm text-ink-3">
            A sharper view of your KS Fit / WalkingPad activity.
          </p>
        </div>
        <LoginForm from={sp.from} />
        <p className="mt-6 text-center text-xs text-ink-4">
          Read-only. Credentials hit{" "}
          <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-3">
            eu.api.ks.fit
          </code>{" "}
          directly — never our servers.
        </p>
      </div>
    </div>
  );
}
