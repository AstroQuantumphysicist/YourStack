'use client';

import { SWRConfig } from 'swr';
import { swrFetcher } from '@/lib/api';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/ui/toast';

/** Global client providers: theme, toasts, and SWR defaults. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <SWRConfig
          value={{
            fetcher: swrFetcher,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
            dedupingInterval: 4000,
          }}
        >
          {children}
        </SWRConfig>
      </ToastProvider>
    </ThemeProvider>
  );
}
