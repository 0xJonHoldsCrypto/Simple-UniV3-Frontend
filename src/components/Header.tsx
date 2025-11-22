"use client";
import Link from "next/link";
import ConnectButton from "@/components/ConnectButton";
import { usePathname } from "next/navigation";
import NetworkSwitcher from "@/components/NetworkSwitcher";
//import { ConnectButton } from '@rainbow-me/rainbowkit' // optional if added

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={[
        "px-3 py-1 rounded-xl transition-colors",
        active
          ? "bg-neutral-800 text-white"
          : "text-neutral-300 hover:text-white hover:bg-neutral-800",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export default function Header() {
  return (
    <header className="border-b border-neutral-800">
      <div className="container mx-auto p-4 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <img src="/swap3-logo.svg" alt=".SWAP3" className="h-9 w-auto" />
        </Link>

        <nav className="flex items-center gap-2 text-sm">
          <NavLink href="/" label="Swap" />
          <NavLink href="/pools" label="Pools" />
          <NavLink href="/add" label="Add" />
          <NavLink href="/remove" label="Remove" />
          <NavLink href="/positions" label="Positions" />
        </nav>
        <div className="flex items-center gap-3">
          <NetworkSwitcher />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
