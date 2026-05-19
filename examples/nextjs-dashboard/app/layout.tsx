import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Coronium Reseller Dashboard',
    description: 'Sell Coronium mobile 4G/5G proxies to your customers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
                <div className="max-w-6xl mx-auto px-4 py-8">
                    <header className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-800">
                        <a href="/" className="text-xl font-semibold tracking-tight">
                            🌐 Coronium Reseller
                        </a>
                        <nav className="flex gap-6 text-sm text-zinc-400">
                            <a href="/" className="hover:text-zinc-100">Dashboard</a>
                            <a href="/customers" className="hover:text-zinc-100">Customers</a>
                            <a href="/buy" className="hover:text-zinc-100">Buy</a>
                            <a href="/events" className="hover:text-zinc-100">Events</a>
                        </nav>
                    </header>
                    {children}
                </div>
            </body>
        </html>
    );
}
