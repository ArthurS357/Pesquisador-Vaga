import type { ReactNode } from "react";
import "./globals.css";
import { ToastHost } from "@/components/ToastHost";

export const metadata = {
  title: "Job Engine — Curadoria",
  description: "Painel local de curadoria human-in-the-loop",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        {/* Host global de toasts: vive acima dos cards, sobrevive ao desmonte
            de uma vaga rejeitada (que sai da fila no revalidate). */}
        <ToastHost />
      </body>
    </html>
  );
}
