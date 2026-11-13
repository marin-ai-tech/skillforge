import { useQuery } from "@tanstack/react-query";
import { me, type MeUser } from "../api/client.ts";

export function useMe() {
  return useQuery<MeUser | null>({
    queryKey: ["me"],
    queryFn: me,
    retry: false,
    staleTime: 0,
    // No timer (fix-session-ui): an anonymous tab used to ask every second. The session is read again when a page
    // loads and when the window gets focus; signing in and out in the app update it themselves.
    refetchOnWindowFocus: true,
  });
}

export function roleAtLeast(have: MeUser["role"] | undefined, need: MeUser["role"]): boolean {
  const rank = { viewer: 1, contributor: 2, reviewer: 3, admin: 4 } as const;
  if (!have) return false;
  return rank[have] >= rank[need];
}
