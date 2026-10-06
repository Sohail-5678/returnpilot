"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api/client";
import { reportApiError } from "@/lib/backend-status";
import { GradientDefs } from "@/components/ui/glyph-tile";

function makeClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: reportApiError }),
    mutationCache: new MutationCache({ onError: reportApiError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          if (err instanceof ApiError) {
            if (err.isWaking || err.isQuota) return false;
            if (err.status >= 400 && err.status < 500) return false;
          }
          return count < 2;
        },
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <GradientDefs />
        {children}
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            style: {
              background: "var(--surface-hi)",
              color: "var(--ink)",
              border: "none",
              borderRadius: 22,
              boxShadow: "var(--sh-float)",
              fontFamily: "var(--font-sans)",
            },
          }}
        />
      </MotionConfig>
    </QueryClientProvider>
  );
}
