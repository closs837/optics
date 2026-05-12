import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Optics',
  description: 'A lending workspace for Ink.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
