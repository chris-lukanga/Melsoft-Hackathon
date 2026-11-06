import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TeachMate — Your digital teaching colleague",
  description: "Turn assessments into thoughtful feedback, clear results, and more time to teach. Every result stays in your hands.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
