export function contentTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  switch (ext) {
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".json":
      return "application/json";
    case ".sh":
    case ".txt":
    case ".py":
    case ".js":
    case ".ts":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
