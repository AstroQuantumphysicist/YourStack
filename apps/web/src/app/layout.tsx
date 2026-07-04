import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'YourStack — Bring your own server. We turn it into a cloud.',
    template: '%s · YourStack',
  },
  description:
    'YourStack is a premium bring-your-own-server cloud platform. Connect your own nodes and deploy apps, pipelines, secrets and domains with a control plane you own.',
  applicationName: 'YourStack',
};

export const viewport: Viewport = {
  themeColor: '#08090f',
  width: 'device-width',
  initialScale: 1,
};

// Prevent theme flash: set the class from storage before the app paints.
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('yourstack-theme') || 'dark';
    var r = document.documentElement;
    r.classList.add(t === 'light' ? 'light' : 'dark');
    r.style.colorScheme = t;
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
