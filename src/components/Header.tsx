'use client'
import Link from 'next/link'
import ConnectButton from '@/components/ConnectButton'

//import { ConnectButton } from '@rainbow-me/rainbowkit' // optional if added

export default function Header() {
  return (
    <header className="border-b border-neutral-800">
      <div className="container mx-auto flex items-center justify-between p-4">
        <Link href="/" className="font-bold">Hemi UniV3</Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/pools">Pools</Link>
          <Link href="/add">Add</Link>
          <Link href="/remove">Remove</Link>
          <Link href="/positions">Positions</Link>
        </nav>
         <ConnectButton />
      </div>
    </header>
  )
}