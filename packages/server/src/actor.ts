import type { FastifyRequest } from "fastify";

/** Returns the authenticated username. Ignores X-SkillForge-Actor. */
export function actorFromRequest(request: FastifyRequest): string {
  if (request.user?.username) return request.user.username;
  return "anonymous";
}
