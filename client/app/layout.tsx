import type { Metadata } from 'next';
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
  title: 'Sarvam AI V2V Gateway | Real-Time Voice Assistant',
  description: 'A low-latency, modular real-time Voice-to-Voice conversational AI ecosystem gateway built with Next.js, Fastify, and Sarvam AI.',
  keywords: ['Sarvam AI', 'Real-Time Voice', 'Voice-to-Voice', 'AI Assistant', 'WebSockets', 'Speech-to-Text', 'Text-to-Speech', 'LLM Gateway'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#030014] text-zinc-100 selection:bg-cyan-500/30 selection:text-cyan-300">
        {children}
      </body>
    </html>
  );
}
