import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/context/AuthContext";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: "OrbitLead - AI Sales Assistant",
  description: "Deploy an AI Sales Assistant in minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <body className={`${inter.variable} antialiased font-sans`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
