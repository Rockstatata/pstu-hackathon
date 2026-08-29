import type { Metadata } from "next";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const notoBengali = Noto_Sans_Bengali({
  variable: "--font-bangla",
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Chorui",
  description: "A quiet, dependable way to move money.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${notoBengali.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script
          // This runs before first paint so a stored preference never flashes light.
          dangerouslySetInnerHTML={{
            __html: `try { const saved = localStorage.getItem('chorui.theme'); const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.classList.toggle('dark', dark); const locale = localStorage.getItem('chorui.locale') || (navigator.language.toLowerCase().startsWith('bn') ? 'bn' : 'en'); document.documentElement.lang = locale; document.documentElement.classList.toggle('lang-bn', locale === 'bn'); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()); } catch {}`,
          }}
        />
        <meta name="theme-color" content="light dark" />
      </head>
      <body className="min-h-full flex flex-col"><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
