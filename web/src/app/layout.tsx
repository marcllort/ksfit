import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ThemeApplier, ThemeScript } from "@/components/theme";
import { PwaRegister } from "@/components/pwa-register";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Stride — KS Fit dashboard",
  description: "A view of your WalkingPad activity, sharper than the stock app.",
  applicationName: "Stride",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Stride",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <PwaRegister />
        {children}
        <Toaster
          position="bottom-right"
          theme="system"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast:
                "!rounded-2xl !border-line !bg-paper-1 !text-ink-1 !shadow-card",
            },
          }}
        />
      </body>
    </html>
  );
}
