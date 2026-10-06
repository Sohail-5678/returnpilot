import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { THEME_SCRIPT } from "@/components/shell/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

const description =
  "ReturnPilot is an AI returns agent for a demo store: it uses real tools over MCP, follows a deterministic policy engine, remembers customers, and pauses for a human reviewer before risky refunds. Every step is traced.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ReturnPilot — the returns agent that knows when to ask",
    template: "%s · ReturnPilot",
  },
  description,
  applicationName: "ReturnPilot",
  keywords: ["AI agent", "LangGraph", "MCP", "human-in-the-loop", "Next.js", "FastAPI", "customer support"],
  openGraph: {
    type: "website",
    title: "ReturnPilot — the returns agent that knows when to ask",
    description,
    siteName: "ReturnPilot",
  },
  twitter: {
    card: "summary_large_image",
    title: "ReturnPilot — the returns agent that knows when to ask",
    description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e7e8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#15152b" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${jetbrains.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div aria-hidden>
          <div className="blob -top-24 right-[8%] size-[380px]" style={{ background: "var(--blob-a)" }} />
          <div
            className="blob -bottom-16 left-[6%] size-[320px]"
            style={{ background: "var(--blob-b)", animationDelay: "-7s" }}
          />
        </div>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-surface focus:px-5 focus:py-3 focus:font-semibold focus:shadow-raised"
        >
          Skip to content
        </a>
        <Providers>
          <div className="relative z-10">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
