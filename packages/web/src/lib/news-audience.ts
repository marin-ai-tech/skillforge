import { useQuery } from "@tanstack/react-query";
import { getTeam, listTeams, type MeUser } from "../api/client.ts";

/** An audience a user may post to: `team` null is everyone. */
export type NewsAudience = { team: string | null; label: string };

/**
 * Audiences from the existing teams API: an admin gets everyone and every team, a team lead only the teams where
 * they are `lead`, anyone else none (no post button at all).
 */
async function loadAudiences(user: MeUser, everyone: string): Promise<NewsAudience[]> {
  const { items } = await listTeams();
  if (user.role === "admin") {
    return [
      { team: null, label: everyone },
      ...items.map((t) => ({ team: t.name, label: t.name })),
    ];
  }
  const mine = items.filter((t) => t.is_member);
  const details = await Promise.all(mine.map((t) => getTeam(t.name).catch(() => null)));
  return details
    .filter((d) => d?.members?.some((m) => m.username === user.username && m.role === "lead"))
    .map((d) => ({ team: d!.name, label: d!.name }));
}

export function useNewsAudiences(user: MeUser | null, everyone: string) {
  return useQuery({
    queryKey: ["news-audiences", user?.username ?? "", user?.role ?? ""],
    queryFn: () => loadAudiences(user!, everyone),
    enabled: !!user,
    staleTime: 60_000,
  });
}
