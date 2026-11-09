import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { ApiError } from "../client.ts";

function invalid(message: string): ApiError {
  return new ApiError(message, EXIT.VALIDATION);
}

export async function runTeamsList(ctx: AppContext): Promise<void> {
  const { client } = requireClient(ctx);
  const res = await client.request("GET", "/api/v1/teams");
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as {
    items: Array<{
      name: string;
      display_name: string | null;
      description: string | null;
      members_count: number | null;
      is_member: boolean;
    }>;
  };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    const rows = data.items.map((t) => [
      t.name,
      t.display_name ?? "-",
      t.members_count === null ? "-" : String(t.members_count),
      t.is_member ? "yes" : "no",
    ]);
    ctx.out.printTable(["name", "display_name", "members", "member"], rows);
  }
  setExit(EXIT.OK);
}

export async function runTeamsShow(ctx: AppContext, name: string): Promise<void> {
  if (!name) throw invalid("team name is required");
  const { client } = requireClient(ctx);
  const res = await client.request("GET", `/api/v1/teams/${encodeURIComponent(name)}`);
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as {
    name: string;
    display_name: string | null;
    description: string | null;
    members: Array<{ username: string; role: string }> | null;
    is_member: boolean;
  };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    ctx.out.write(`${data.name}`);
    if (data.display_name) ctx.out.write(data.display_name);
    if (data.description) ctx.out.write(data.description);
    if (data.members) {
      for (const m of data.members) ctx.out.write(`${m.username}\t${m.role}`);
    } else {
      ctx.out.write("(members hidden)");
    }
  }
  setExit(EXIT.OK);
}

export async function runTeamsCreate(
  ctx: AppContext,
  name: string,
  opts: { lead?: string },
): Promise<void> {
  if (!name) throw invalid("team name is required");
  if (!opts.lead) throw invalid("--lead <user> is required");
  const { client } = requireClient(ctx);
  const res = await client.request("POST", "/api/v1/teams", {
    body: { name, lead: opts.lead },
  });
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) ctx.out.printJson(res.data);
  else ctx.out.write(`created team ${name} lead=${opts.lead}`);
  setExit(EXIT.OK);
}

export async function runTeamsAdd(
  ctx: AppContext,
  name: string,
  username: string,
  opts: { role?: string },
): Promise<void> {
  if (!name || !username) throw invalid("team name and username are required");
  const role = opts.role ?? "member";
  if (role !== "member" && role !== "lead") throw invalid("--role must be member or lead");
  const { client } = requireClient(ctx);
  const res = await client.request("POST", `/api/v1/teams/${encodeURIComponent(name)}/members`, {
    body: { username, role },
  });
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) ctx.out.printJson(res.data);
  else ctx.out.write(`added ${username} as ${role} to ${name}`);
  setExit(EXIT.OK);
}

export async function runTeamsRemove(
  ctx: AppContext,
  name: string,
  username: string,
): Promise<void> {
  if (!name || !username) throw invalid("team name and username are required");
  const { client } = requireClient(ctx);
  const res = await client.request(
    "DELETE",
    `/api/v1/teams/${encodeURIComponent(name)}/members/${encodeURIComponent(username)}`,
  );
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) ctx.out.printJson(res.data);
  else ctx.out.write(`removed ${username} from ${name}`);
  setExit(EXIT.OK);
}
