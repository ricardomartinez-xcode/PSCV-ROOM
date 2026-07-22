import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { PushNotificationsBootstrap } from "@/components/push-notifications-bootstrap";
import "./globals.css";
import "./responsive.css";
import "./evolution.css";
import "./auth.css";
import "./material-library.css";
import "./admin-hub.css";
import "./admin-fixes.css";
import "./workspace.css";
import "./notification-center.css";
import "./events-flow.css";
import "./admin-modern.css";
import "./admin-reports.css";
import "./admin-diagnostics.css";
import "./admin-notices.css";
import "./admin-workspaces.css";
import "./mobile-calendar.css";
import "./task-materials.css";
import "./accessibility.css";

export const metadata: Metadata = {
  title: "PSCV Room 2.0",
  description: "Panel moderno de tareas, materiales y calendario para psicología.",
  applicationName: "PSCV Room",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PSCV Room",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }],
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#208dac",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>
        <Providers>
          <PushNotificationsBootstrap>
            {children}
          </PushNotificationsBootstrap>
        </Providers>
      </body>
    </html>
  );
}
