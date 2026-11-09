// Facade for the publish path; implementation
// lives in ./publish/{types,prepare,commit,artifact}.ts. Keep this file re-export-only
// so existing `from "../publish.ts"` imports keep working.
export * from "./publish/index.ts";
