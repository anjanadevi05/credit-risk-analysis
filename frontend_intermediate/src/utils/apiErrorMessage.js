/** Short message for alerts; avoids dumping HTML error pages. */
export function apiErrorMessage(err) {
  const status = err.response?.status;
  const data = err.response?.data;

  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.includes("<!DOCTYPE") || trimmed.includes("<html")) {
      const pre = trimmed.match(/<pre[^>]*>([^<]*)<\/pre>/i);
      if (pre) {
        const line = pre[1].trim();
        if (line.includes("Cannot DELETE") || line.includes("Cannot GET")) {
          return `${line} (is the Node API on port 3000 running? Wrong URL hits the dev server.)`;
        }
        return line;
      }
      return status
        ? `HTTP ${status}: server returned HTML instead of JSON — check API URL/port.`
        : "Server returned HTML instead of JSON.";
    }
    return trimmed.slice(0, 200);
  }

  if (data && typeof data === "object") {
    return (
      data.detail ||
      data.error ||
      data.message ||
      (status ? `HTTP ${status}` : "Request failed")
    );
  }

  return err.message || "Request failed";
}
