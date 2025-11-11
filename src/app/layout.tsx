'use client'
import '../styles/globals.css'
import { WagmiProvider } from 'wagmi'
import { config, hemi } from '@/lib/wagmi'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import NetworkGuard from '@/components/NetworkGuard'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient())
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <WagmiProvider config={config}>
          <QueryClientProvider client={qc}>
            <NetworkGuard />
            <Header />
            <main className="container mx-auto p-4 max-w-5xl">{children}</main>
            <Footer />
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  )
}