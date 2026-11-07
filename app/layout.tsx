import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { Toaster } from "@/components/Toaster";

export const metadata: Metadata = {
  title: { default: "Runa — mesa de dados", template: "%s · Runa" },
  description: "Role dados de RPG com física 3D, crie mesas online e acompanhe as rolagens de todos em tempo real.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#1b2333",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <SiteHeader />
          <main>{children}</main>
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
