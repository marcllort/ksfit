import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ThemeApplier, ThemeScript } from "@/components/theme";

export const metadata: Metadata = {
  title: "Stride — KS Fit dashboard",
  description: "A view of your WalkingPad activity, sharper than the stock app.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={{
        ["--font-sans" as never]: "var(--font-geist-sans)",
        ["--font-mono" as never]: "var(--font-geist-mono)",
      }}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="font-sans antialiased min-h-dvh bg-paper-0 text-ink-1">
        <ThemeApplier />
        {children}
      </body>
    </html>
  );
}
