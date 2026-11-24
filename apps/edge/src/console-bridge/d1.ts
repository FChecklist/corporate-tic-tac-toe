// The smallest piece of Cloudflare D1 that the console and the bridge use. Tests give the same shape from bun:sqlite.
export interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = any>(): Promise<{ results: T[] }>;
  first<T = any>(): Promise<T | null>;
}
export interface D1 {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
}
