export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({ error: "The server returned an unreadable response. Please retry." }));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

export const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
export const displayStatus = (status: string) => status.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
export const shortDate = (date: string) => new Date(date).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
export const shortTime = (date: string) => new Date(date).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Johannesburg" });
export const number = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);

export type View = "dashboard" | "new" | "workspace" | "review" | "reports" | "classes";
export const viewLabels: Record<View, string> = { dashboard: "Dashboard", new: "New assignment", workspace: "Agent workspace", review: "Review desk", reports: "Reports & gradebook", classes: "My classes" };
