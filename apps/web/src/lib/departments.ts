import { ENV } from "../env.public";

export type Department = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
};

export type DepartmentInput = {
  name: string;
  description?: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ENV.VITE_SERVER_URL}/api/departments${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const departmentsApi = {
  list: () => request<Department[]>("/"),
  create: (input: DepartmentInput) =>
    request<Department>("/", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: Partial<DepartmentInput>) =>
    request<Department>(`/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/${id}`, { method: "DELETE" }),
};
