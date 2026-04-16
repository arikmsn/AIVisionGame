import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GameProvider } from "@/context/GameContext";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'),
  title: "AI Vision Arena: Can you beat the machine?",
  description: "Real-time AI vision guessing game - Challenge your friends and see who can guess AI-generated images faster!",
  openGraph: {
    title: "AI Vision Arena: Can you beat the machine?",
    description: "Real-time AI vision guessing game - Challenge your friends!",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AI Vision Arena",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Vision Arena: Can you beat the machine?",
    description: "Real-time AI vision guessing game - Challenge your friends!",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <GameProvider>{children}</GameProvider>
        <Analytics />
      </body>
    </html>
  );
}
