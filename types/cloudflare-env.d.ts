export {};

declare global {
  type D1Row = Record<string, unknown>;
  interface D1Result<T = D1Row> { results: T[]; success: boolean; meta?: Record<string, unknown>; }
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    all<T = D1Row>(): Promise<D1Result<T>>;
    first<T = D1Row>(): Promise<T | null>;
    run(): Promise<D1Result>;
  }
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  }
  interface R2Object { key: string; size: number; etag: string; httpEtag: string; uploaded: Date; httpMetadata?: { contentType?: string; contentDisposition?: string }; body: ReadableStream; writeHttpMetadata(headers: Headers): void; }
  interface R2Bucket {
    get(key: string): Promise<R2Object | null>;
    put(key: string, value: ReadableStream | ArrayBuffer | string | null, options?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }): Promise<unknown>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string; delimiter?: string }): Promise<{ objects: Array<{ key: string; size: number; uploaded: Date; etag: string }>; truncated: boolean; cursor?: string; delimitedPrefixes: string[] }>;
  }
  interface CloudflareEnv {
    DB: D1Database;
    MATERIALS_BUCKET: R2Bucket;
    APP_NAME: string;
    AUTH_MODE: "cloudflare-access" | "development";
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    AUTH_IDENTITY_PROVIDER?: string;
    DEV_AUTH_EMAIL?: string;
    ALLOW_DEV_AUTH?: string;
    R2_PUBLIC_BASE_URL?: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_IMAGES_API_TOKEN?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  }
}
