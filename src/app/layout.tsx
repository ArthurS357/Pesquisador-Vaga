import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Job Engine — Curadoria",
  description: "Painel local de curadoria human-in-the-loop",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
