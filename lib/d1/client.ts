"use client";

import type { DataFilter, DataOrder, DataQuery } from "@/lib/server/d1-data";

type QueryError = { message: string } | null;
type DataObject = Record<string, unknown>;
type QueryResult<T = DataObject[]> = { data: T | null; error: QueryError; count?: number | null };
type AuthSession = { user: { id: string; email: string } } | null;
type AuthChangeSubscription = { data: { subscription: { unsubscribe: () => void } } };

class D1QueryBuilder<T = DataObject[]> implements PromiseLike<QueryResult<T>> {
  private query: DataQuery;
  private clientError: string | null = null;

  constructor(table: string) {
    this.query = {
      table,
      action: "select",
      filters: [],
      order: [],
    };
  }

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.query.select = columns;
    this.query.count = options?.count;
    this.query.head = options?.head;
    return this;
  }

  insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.query.action = "insert";
    this.query.values = values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.query.action = "update";
    this.query.values = values;
    return this;
  }

  upsert(values: Record<string, unknown> | Array<Record<string, unknown>>, options?: { onConflict?: string }) {
    this.query.action = "upsert";
    this.query.values = values;
    this.query.onConflict = options?.onConflict;
    return this;
  }

  delete() {
    this.query.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    return this.addFilter({ op: "eq", column, value });
  }

  is(column: string, value: null) {
    return this.addFilter({ op: "is", column, value });
  }

  not(column: string, operator: "is", value: null) {
    return this.addFilter({ op: "not", column, operator, value });
  }

  in(column: string, value: unknown[]) {
    return this.addFilter({ op: "in", column, value });
  }

  lte(column: string, value: unknown) {
    return this.addFilter({ op: "lte", column, value });
  }

  or(expression: string) {
    void expression;
    this.clientError = "El adaptador D1 no soporta filtros OR desde el navegador.";
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    const order = this.query.order ?? [];
    order.push({ column, ascending: options?.ascending !== false } satisfies DataOrder);
    this.query.order = order;
    return this;
  }

  limit(limit: number) {
    this.query.limit = limit;
    return this;
  }

  single<R = DataObject>() {
    this.query.single = true;
    return this as unknown as D1QueryBuilder<R>;
  }

  maybeSingle<R = DataObject>() {
    this.query.maybeSingle = true;
    return this as unknown as D1QueryBuilder<R>;
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private addFilter(filter: DataFilter) {
    this.query.filters = [...(this.query.filters ?? []), filter];
    return this;
  }

  private async execute(): Promise<QueryResult<T>> {
    if (this.clientError) return { data: null, error: { message: this.clientError } };

    try {
      const response = await fetch("/api/data", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "query", query: this.query }),
      });
      const body = await response.json().catch(() => ({})) as QueryResult<T> & { error?: QueryError | string };
      if (!response.ok) {
        const message = typeof body.error === "string" ? body.error : body.error?.message;
        return { data: null, error: { message: message ?? "No se pudo consultar D1." } };
      }
      return {
        data: body.data ?? null,
        error: typeof body.error === "string" ? { message: body.error } : body.error ?? null,
        count: body.count,
      };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : "No se pudo consultar D1." } };
    }
  }
}

class D1BrowserClient {
  auth = {
    async getSession(): Promise<QueryResult<{ session: AuthSession }>> {
      try {
        const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => ({})) as { identity?: { email?: string }; profile?: { id?: string }; error?: string };
        if (!response.ok) return { data: { session: null }, error: { message: body.error ?? "Sesión no encontrada." } };
        return { data: { session: { user: { id: body.profile?.id ?? "", email: body.identity?.email ?? "" } } }, error: null };
      } catch (error) {
        return { data: { session: null }, error: { message: error instanceof Error ? error.message : "Sesión no encontrada." } };
      }
    },
    onAuthStateChange(callback?: (event: string, session: AuthSession) => void): AuthChangeSubscription {
      void callback;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    async getUser() {
      const session = await this.getSession();
      return { data: { user: session.data?.session?.user ?? null }, error: session.error };
    },
    async signOut() {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo de nuevo.");
      return { error: null };
    },
  };

  from<T = DataObject[]>(table: string) {
    return new D1QueryBuilder<T>(table);
  }

  rpc<T = unknown>(name: string, args: Record<string, unknown>) {
    return {
      then<TResult1 = QueryResult<T>, TResult2 = never>(
        onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        return fetch("/api/data", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "rpc", name, args }),
        })
          .then(async (response) => {
            const body = await response.json().catch(() => ({})) as QueryResult<T> & { error?: QueryError | string };
            if (!response.ok) {
              const message = typeof body.error === "string" ? body.error : body.error?.message;
              return { data: null, error: { message: message ?? "RPC D1 falló." } };
            }
            return { data: body.data ?? null, error: typeof body.error === "string" ? { message: body.error } : body.error ?? null };
          })
          .then(onfulfilled, onrejected);
      },
    };
  }
}

let browserClient: D1BrowserClient | null = null;

export function hasD1BrowserConfig() {
  return true;
}

export function createD1BrowserClient() {
  if (!browserClient) browserClient = new D1BrowserClient();
  return browserClient;
}
