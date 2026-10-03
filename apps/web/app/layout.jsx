import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { NO_FLASH } from '@/components/Theme.jsx';
import { Shell } from '@/components/Shell.jsx';
import { StoreProvider } from '@/lib/store.jsx';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: { default: 'Cadence', template: '%s · Cadence' },
  description: 'Speech synthesis that runs on your own machine. No key, no server, no quota.',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eceef5' },
    { media: '(prefers-color-scheme: dark)', color: '#05060a' },
  ],
};

/** @param {{children: React.ReactNode}} props */
export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* The theme must be on <html> before the first paint, or dark users
            see a flash of light. This runs before the body exists. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <StoreProvider>
          <Shell>{children}</Shell>
        </StoreProvider>
      </body>
    </html>
  );
}
