import type { Metadata } from 'next';
import { env } from '@/db/runtime';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    env.APP_ORIGIN ?? 'https://optics.tmayllart.chatgpt.site',
  ),
  icons: { icon: '/favicon.svg' },
  title: 'Optics — Lending intelligence on Ink',
  description:
    'An independent Tydro lending workspace on Ink. Live markets, portfolio exposure, saved risk scenarios, protocol activity, and alerts.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
