import { useQuery } from "@tanstack/react-query";
import { me, type MeUser } from "../api/client.ts";

export function useMe() {
  return useQuery<MeUser | null>({
    queryKey: ["me"],
    queryFn: me,
    retry: false,
    staleTime: 0,
    // While anonymous, poll so API-cookie logins (e2e loginAs) appear without a full reload.
    refetchInterval: (q) => (q.state.data ? false : 1000),
  });
}

export function roleAtLeast(have: MeUser["role"] | undefined, need: MeUser["role"]): boolean {
  const rank = { viewer: 1, contributor: 2, reviewer: 3, admin: 4 } as const;
  if (!have) return false;
  return rank[have] >= rank[need];
}
