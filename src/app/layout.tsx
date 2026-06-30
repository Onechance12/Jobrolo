import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { OfflineStatus } from "@/components/pwa/offline-status";

export const metadata: Metadata = {
  title: "Jobrolo — AI Contractor OS",
  description: "Chat-first CRM for contractors",
  applicationName: 'Jobrolo',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Jobrolo',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/logo.png', sizes: '512x512', type: 'image/png' },
      { url: '/logo.svg', type: 'image/svg+xml' },
    ],
    apple: '/logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#020617',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <PwaRegister />
          <OfflineStatus />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
