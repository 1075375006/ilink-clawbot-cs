import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SupportAgent } from "../types";

interface SupportAuthValue {
  agent: SupportAgent | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  expire: () => void;
}

const SupportAuthContext = createContext<SupportAuthValue | null>(null);

export function SupportAuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["support-session"],
    queryFn: () => api<{ agent: SupportAgent | null }>("/api/support/auth/me"),
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const expire = useCallback(() => {
    void client.cancelQueries({ queryKey: ["support"] });
    client.removeQueries({ queryKey: ["support"] });
    client.setQueryData(["support-session"], { agent: null });
  }, [client]);
  const login = async (username: string, password: string) => {
    const data = await api<{ agent: SupportAgent }>("/api/support/auth/login", {
      method: "POST",
      json: { username, password },
    });
    client.removeQueries({ queryKey: ["support"] });
    client.setQueryData(["support-session"], data);
  };
  const logout = async () => {
    await api("/api/support/auth/logout", { method: "POST" });
    expire();
  };
  return (
    <SupportAuthContext.Provider
      value={{
        agent: session.data?.agent ?? null,
        loading: session.isPending,
        login,
        logout,
        expire,
      }}
    >
      {children}
    </SupportAuthContext.Provider>
  );
}

export function useSupportAuth() {
  const value = useContext(SupportAuthContext);
  if (!value)
    throw new Error("useSupportAuth must be used inside SupportAuthProvider");
  return value;
}
