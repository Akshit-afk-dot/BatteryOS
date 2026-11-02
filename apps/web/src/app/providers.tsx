"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster, toast } from "sonner";

import { TooltipProvider } from "@/components/overlay";
import { ApiError, errorMessage } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) => {
            // Mutations can opt out (meta.silent) when they render the error inline.
            if (mutation.meta?.silent) return;
            toast.error(errorMessage(err));
          },
        }),
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: "font-sans" }} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
