import { roleAtLeast, type Role } from "../auth/users.ts";

export const STATUSES = ["candidate", "active", "aging", "zombie", "retired"] as const;
export type Status = (typeof STATUSES)[number];

export const TRANSITIONS: Record<Status, readonly Status[]> = {
  candidate: ["active", "retired"],
  active: ["aging", "zombie", "retired"],
  aging: ["active", "zombie", "retired"],
  zombie: ["active", "retired"],
  retired: ["candidate"],
};

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: string, to: string): boolean {
  if (!isStatus(from) || !isStatus(to)) return false;
  return (TRANSITIONS[from] as readonly string[]).includes(to);
}

export function allowedTransitions(status: string, role: Role | null | undefined): Status[] {
  if (!role || !roleAtLeast(role, "reviewer")) return [];
  if (!isStatus(status)) return [];
  return [...TRANSITIONS[status]];
}
