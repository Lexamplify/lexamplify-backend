"""Merge lex_assistant.db and client_data.db into instance/database.db.
Run from repo root: python -I backend/scripts/merge_databases.py
"""
import sqlite3, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAIN_DB = os.path.join(BASE, 'instance', 'database.db')
LEX_DB = os.path.join(BASE, 'lex_assistant.db')
CLIENT_DB = os.path.join(BASE, 'instance', 'client_data.db')


def get_tables(db_path):
    conn = sqlite3.connect(db_path)
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()]
    conn.close()
    return tables


def get_create_sql(db_path, table):
    conn = sqlite3.connect(db_path)
    sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()[0]
    conn.close()
    return sql


def get_indexes(db_path, table):
    conn = sqlite3.connect(db_path)
    indexes = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        (table,)
    ).fetchall()
    conn.close()
    return [r[0] for r in indexes]


def migrate_db(source_path, source_name):
    if not os.path.exists(source_path):
        print(f"  {source_name} not found, skipping")
        return

    source_tables = get_tables(source_path)
    main_tables = get_tables(MAIN_DB)

    print(f"\n=== Migrating {source_name} ({len(source_tables)} tables) ===")

    main_conn = sqlite3.connect(MAIN_DB)
    source_conn = sqlite3.connect(source_path)

    # Skip FTS shadow tables — they have internal constraints and rebuild automatically
    fts_suffixes = ('_data', '_idx', '_content', '_docsize', '_config')
    skip_fts = set()
    for t in source_tables:
        if any(t.endswith(s) for s in fts_suffixes):
            skip_fts.add(t)
        # Also skip the FTS virtual table itself if it exists in main
        if t in main_tables:
            try:
                source_conn.execute(f"SELECT * FROM [{t}] WHERE 0")  # just test access
            except:
                skip_fts.add(t)

    for table in source_tables:
        if table in skip_fts:
            print(f"  SKIP {table} — FTS internal table")
            continue
        if table in main_tables:
            # Check if it already has data (already migrated)
            existing = main_conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
            source_count = source_conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
            if existing > 0:
                print(f"  SKIP {table} — already exists in main DB with {existing} rows")
                continue
            elif source_count > 0:
                # Table exists but empty in main, has data in source — copy data
                cols = [r[1] for r in source_conn.execute(f"PRAGMA table_info([{table}])").fetchall()]
                col_list = ', '.join(f'[{c}]' for c in cols)
                placeholders = ', '.join('?' * len(cols))
                rows = source_conn.execute(f"SELECT {col_list} FROM [{table}]").fetchall()
                main_conn.executemany(
                    f"INSERT OR IGNORE INTO [{table}] ({col_list}) VALUES ({placeholders})", rows
                )
                print(f"  DATA {table} — copied {len(rows)} rows (table already existed)")
                continue
            else:
                print(f"  SKIP {table} — exists in both, both empty")
                continue

        # Create table in main DB
        create_sql = get_create_sql(source_path, table)
        try:
            main_conn.execute(create_sql)
        except Exception as e:
            print(f"  ERROR creating {table}: {e}")
            continue

        # Copy indexes
        for idx_sql in get_indexes(source_path, table):
            try:
                main_conn.execute(idx_sql)
            except:
                pass

        # Copy data
        cols = [r[1] for r in source_conn.execute(f"PRAGMA table_info([{table}])").fetchall()]
        col_list = ', '.join(f'[{c}]' for c in cols)
        placeholders = ', '.join('?' * len(cols))
        rows = source_conn.execute(f"SELECT {col_list} FROM [{table}]").fetchall()
        if rows:
            main_conn.executemany(
                f"INSERT OR IGNORE INTO [{table}] ({col_list}) VALUES ({placeholders})", rows
            )
        print(f"  OK   {table} — {len(rows)} rows")

    main_conn.commit()
    main_conn.close()
    source_conn.close()


# Run migrations
migrate_db(LEX_DB, 'lex_assistant.db')
migrate_db(CLIENT_DB, 'client_data.db')

# Verify
print("\n=== Final table count in main DB ===")
main_tables = get_tables(MAIN_DB)
print(f"  {len(main_tables)} tables total")

print("\nDone! Now update app.py to point _lpms_db to instance/database.db")
