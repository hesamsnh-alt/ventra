import "./globals.css";

export const metadata = {
  title: "Ventra | AI Construction Estimation Platform",
  description:
    "AI-powered construction estimation, BOQ and quotation platform.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
