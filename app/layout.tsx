import type { Metadata } from "next";
import {
  Be_Vietnam_Pro,
  IBM_Plex_Mono,
  Inter,
  Space_Grotesk
} from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

const captureDisplay = Space_Grotesk({
  subsets: ["latin", "vietnamese"],
  weight: "600",
  variable: "--font-capture-display"
});

const captureUi = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600"],
  variable: "--font-capture-ui"
});

const captureData = IBM_Plex_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600"],
  variable: "--font-capture-data"
});

export const metadata: Metadata = {
  title: "Money Smart Tracker",
  description: "A personal finance tracker built with Next.js."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${captureDisplay.variable} ${captureUi.variable} ${captureData.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
