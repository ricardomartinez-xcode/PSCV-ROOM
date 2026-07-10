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
import "./events-flow.css";
import "./push-notifications.css";

export const metadata: Metadata = {
  title: "PSCV Room 2.0",
  description: "Panel moderno de tareas, materiales y calendario para psicología.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
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
    <html lang="es">
      <body>
        <Providers>
          <PushNotificationsBootstrap />
          {children}
        </Providers>
      </body>
    </html>
  );
}
