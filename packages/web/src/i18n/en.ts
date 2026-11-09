// English interface dictionary — the source of keys and of the `Messages` type.
// Sections live in `en/<section>.ts`; every other dictionary (`<code>.ts`) must have exactly the same shape.
import { base } from "./en/base.ts";
import { ui } from "./en/ui.ts";
import { art } from "./en/art.ts";
import { ws } from "./en/ws.ts";
import { adm } from "./en/adm.ts";
import { tips } from "./en/tips.ts";
import { flow } from "./en/flow.ts";
import { codes, apiErrors } from "./en/codes.ts";

export const en = { ...base, ui, art, ws, flow, adm, tips, codes, apiErrors };

export type Messages = typeof en;
