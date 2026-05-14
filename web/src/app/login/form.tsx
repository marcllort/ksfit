"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui";

export function LoginForm({ from }: { from?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setPending(true);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(body.error || "Login failed.");
        return;
      }
      router.replace(from || "/");
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-3xl border border-line bg-paper-1 p-6 shadow-card dark:shadow-card-dark"
    >
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          autoFocus
          className="focus-ring mt-2 w-full rounded-xl border border-line bg-paper-0 px-3 py-2.5 text-[15px] text-ink-1 outline-none transition-colors placeholder:text-ink-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
          Password
        </span>
        <div className="relative mt-2">
          <input
            type={showPw ? "text" : "password"}
            required
            autoComplete="current-password"
            className="focus-ring w-full rounded-xl border border-line bg-paper-0 px-3 py-2.5 pr-10 text-[15px] text-ink-1 outline-none transition-colors placeholder:text-ink-4"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-3 hover:bg-paper-2"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>

      {err ? (
        <div className="mt-4 rounded-xl border border-[color:var(--bad)]/30 bg-[color:var(--bad)]/10 px-3 py-2 text-sm text-[color:var(--bad)]">
          {err}
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        className="mt-6 w-full"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
