import { createRequire } from "node:module";

export interface AvenSqliteStatement {
  run(...params: readonly unknown[]): unknown;
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown;
}

export interface AvenSqliteDatabase {
  exec(sql: string): unknown;
  close(): void;
  prepare(sql: string): AvenSqliteStatement;
}

export interface AvenSqliteOpenOptions {
  readonly walMode?: boolean;
}

type SqlDatabaseConstructor = new (path: string) => AvenSqliteDatabase;

export function openAvenSqliteDatabase(
  path: string,
  options?: AvenSqliteOpenOptions,
): AvenSqliteDatabase {
  const db = new (loadDatabaseSync())(path);
  if (options?.walMode !== false) {
    db.exec("PRAGMA journal_mode=WAL");
  }
  return db;
}

function loadDatabaseSync(): SqlDatabaseConstructor {
  const require = createRequire(import.meta.url);
  try {
    const sqliteModule = require("node:sqlite") as {
      DatabaseSync?: SqlDatabaseConstructor;
    };
    if (!sqliteModule.DatabaseSync) {
      throw new Error("DatabaseSync export is not available from node:sqlite");
    }
    return sqliteModule.DatabaseSync;
  } catch (nodeSqliteError) {
    try {
      const bunSqliteModule = require("bun:sqlite") as {
        Database?: SqlDatabaseConstructor;
      };
      if (!bunSqliteModule.Database) {
        throw new Error("Database export is not available from bun:sqlite");
      }
      return bunSqliteModule.Database;
    } catch (bunSqliteError) {
      throw new Error(
        "SQLite support requires either Node's built-in 'node:sqlite' module or Bun's 'bun:sqlite' module. Neither backend is available in this runtime.",
        { cause: { nodeSqliteError, bunSqliteError } },
      );
    }
  }
}