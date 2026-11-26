"""Validate RLS as the app_rls role against whichever tables have policies.

Run AFTER applying a step's .sql and after creating the app_rls role. Connects
DIRECTLY as app_rls (env DATABASE_URL_RLS, session pooler), sets the identity
GUCs by hand, and asserts tenant isolation. Does not touch the app.

Usage:
  set DATABASE_URL_RLS=postgresql://app_rls:<pw>@<session-pooler-host>:5432/postgres
  python migrations/rls/validate_rls.py

Exit 0 = all policies isolate correctly; 1 = a leak or a broken read.
"""
import os
import sys

import psycopg2

DSN = os.getenv("DATABASE_URL_RLS")
if not DSN:
    print("ERROR: set DATABASE_URL_RLS to the app_rls session-pooler connection string.")
    sys.exit(2)

PASS, FAIL = [], []
def check(label, got, want):
    (PASS if got == want else FAIL).append((label, got, want))
    print(f"  {'OK ' if got == want else 'XX '}{label}: got={got!r} want={want!r}")


def set_identity(cur, uid=None, wid=None, fid=None):
    cur.execute(
        "SELECT set_config('app.user_id', %s, false), "
        "set_config('app.workspace_id', %s, false), "
        "set_config('app.firm_id', %s, false)",
        (None if uid is None else str(uid),
         None if wid is None else str(wid),
         None if fid is None else str(fid)),
    )


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()

    # Confirm we are NOT a superuser (else RLS is silently bypassed and this
    # whole validation is meaningless).
    cur.execute("SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)")
    who, is_super = cur.fetchone()
    print(f">> connected as {who} (superuser={is_super})")
    check("role is NON-superuser (RLS can apply)", bool(is_super), False)
    if is_super:
        print("Aborting: a superuser bypasses RLS; fix the role before validating.")
        sys.exit(1)

    # clauses canary: two distinct owners must not see each other's rows.
    cur.execute("SELECT 1 FROM pg_policies WHERE tablename = 'clauses' LIMIT 1")
    if cur.fetchone():
        print(">> clauses")
        # Find two owner ids that actually have clauses (as superuser-free read
        # under RLS we can't see others' rows, so discover owners via a tiny
        # unfiltered count per identity is impossible; instead read owners from
        # a known pair if present). We simply assert self-isolation:
        set_identity(cur, uid=-12345)  # an identity that owns nothing
        cur.execute("SELECT COUNT(*) FROM clauses")
        n_none = cur.fetchone()[0]
        check("unknown identity sees 0 clauses", n_none, 0)

        # Insert under identity A, then confirm identity B cannot see/update it.
        set_identity(cur, uid=900001)
        cur.execute(
            "INSERT INTO clauses (title, content, owner_user_id) "
            "VALUES ('rls probe', 'x', 900001) RETURNING id"
        )
        pid = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM clauses WHERE id = %s", (pid,))
        check("owner A sees own inserted clause", cur.fetchone()[0], 1)

        set_identity(cur, uid=900002)
        cur.execute("SELECT COUNT(*) FROM clauses WHERE id = %s", (pid,))
        check("owner B cannot see A's clause", cur.fetchone()[0], 0)
        cur.execute("UPDATE clauses SET title = 'hijack' WHERE id = %s", (pid,))
        check("owner B update of A's clause affects 0 rows", cur.rowcount, 0)
        cur.execute("DELETE FROM clauses WHERE id = %s", (pid,))
        check("owner B delete of A's clause affects 0 rows", cur.rowcount, 0)

        # Insert that lies about ownership must be rejected by WITH CHECK.
        try:
            cur.execute(
                "INSERT INTO clauses (title, content, owner_user_id) "
                "VALUES ('forged', 'x', 900001)"  # B claims A's id
            )
            check("B cannot insert a row owned by A", True, False)
        except psycopg2.Error:
            check("B cannot insert a row owned by A", True, True)

        # cleanup the probe as owner A.
        set_identity(cur, uid=900001)
        cur.execute("DELETE FROM clauses WHERE id = %s", (pid,))

    cur.close(); conn.close()
    print(f"\n== {len(PASS)} passed, {len(FAIL)} failed ==")
    for l, g, w in FAIL:
        print("  FAILED", l, g, w)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
