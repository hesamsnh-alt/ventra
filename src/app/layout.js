import "./globals.css";
import LanguageProvider from "./components/i18n/LanguageProvider";
import VentraHelper from "./components/help/VentraHelper";
import {cookies} from "next/headers";
import {normalizeLanguage,languageDirection} from "@/lib/i18n/translate.mjs";

export const metadata = {
  title: "Ventra | AI Construction Estimation Platform",
  description:
    "AI-powered construction estimation, BOQ and quotation platform.",
};

export default async function RootLayout({ children }) {
  const language=normalizeLanguage((await cookies()).get('ventra-language')?.value);
  return (
    <html lang={language} dir={languageDirection(language)} data-scroll-behavior="smooth">
      <body><LanguageProvider initialLanguage={language}>{children}<VentraHelper /></LanguageProvider></body>
    </html>
  );
}
