"""
routes/vault_files_routes.py - the 7 Case Vault folder and document file/list/meta routes.

Moved verbatim out of app.py's create_app() (step 3, commit 2).
Each handler imports app as app_module locally so app-level helpers and the
thread-local SQLite handle (app.db) remain reachable without a top-level
circular import or breaking importlib.reload(app) in tests.

Blueprint: /api/vault
  GET, OPTIONS    /api/vault/folders
  DELETE, OPTIONS /api/vault/folders/<int:folder_id>
  POST, OPTIONS   /api/vault/documents/upload
  DELETE, OPTIONS /api/vault/documents/<int:doc_id>
  GET, OPTIONS    /api/vault/documents/<int:doc_id>/download
  GET             /api/vault/documents
  GET, OPTIONS    /api/vault/meta
"""
import json
import sqlite3

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

vault_files_bp = Blueprint("vault_files", __name__, url_prefix="/api/vault")


# ── Vault Folders API ─────────────────────────────────────────────────────
@vault_files_bp.route('/folders', methods=['GET', 'OPTIONS'])
@jwt_required()
def get_vault_folders():
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        # Two different sets: the folder TREE also shows the folders that merely lead to a shared
        # document (navigation), but document COUNTS may only count documents this user can open.
        member_ids = app_module._current_user_team_member_ids(uid)
        tree_folder_ids, _ = app_module._visible_shared_vault_ids(uid, member_ids=member_ids)
        content_folder_ids, shared_doc_ids = app_module._visible_shared_vault_ids(uid, include_nav=False, member_ids=member_ids)

        # Phase 4 scoping: when a workspace is active, restrict own folders
        # to that workspace + legacy (workspace_id IS NULL). Shared folders
        # (via tree_folder_ids) are intentionally unscoped — a document
        # someone else shared with you crosses workspace boundaries.
        from utils.workspace_scope import current_workspace_id
        _ws = current_workspace_id()
        _ws_sql = ' AND (workspace_id = ? OR workspace_id IS NULL)' if _ws is not None else ''
        _ws_params = (_ws,) if _ws is not None else ()

        conn = app_module.db
        old_rf = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                'SELECT id, name, parent_id, protected, link_shared, created_at FROM vault_folders '
                f'WHERE (user_id = ?{_ws_sql}) OR id IN (SELECT value FROM json_each(?)) ORDER BY name ASC',
                (uid, *_ws_params, json.dumps(sorted(tree_folder_ids)))
            ).fetchall()

            # Direct (own, non-inherited) share counts per folder — the
            # Share badge only ever reflects a node's OWN explicit
            # shares, never ones it merely inherits by cascade from an
            # ancestor, so this is a plain GROUP BY on document_vault_shares
            # itself rather than anything cascade-aware.
            share_count_rows = conn.execute(
                "SELECT node_id, COUNT(*) AS cnt FROM document_vault_shares "
                "WHERE node_type = 'folder' GROUP BY node_id"
            ).fetchall()
            folder_share_counts = {r['node_id']: r['cnt'] for r in share_count_rows}

            folders = [
                {
                    **dict(r),
                    'protected': bool(r['protected']),
                    'link_shared': bool(r['link_shared']),
                    'share_count': folder_share_counts.get(r['id'], 0),
                }
                for r in rows
            ]

            # Cheap GROUP BY for per-folder document counts — never touches
            # `content`, so this stays fast regardless of table size and
            # lets the frontend show folder counts without loading every
            # document just to count them client-side. Scoped the same
            # way as the document list itself (own + legacy + shared, and
            # never documents that are in the Document Hub's trash). This
            # is each folder's OWN direct count — rolled up into a
            # recursive count below, since the vault's document-count
            # display must reflect nested contents too.
            # Mirror the folder-tree workspace scope on own documents here
            # so counts don't reflect docs from other workspaces. Shared
            # docs ignore workspace just as shared folders do above.
            _cnt_ws_sql = ' AND (cv.workspace_id = ? OR cv.workspace_id IS NULL)' if _ws is not None else ''
            count_rows = conn.execute(
                'SELECT cv.folder_id, COUNT(*) AS cnt FROM case_vault cv '
                'WHERE ((cv.user_id = ?' + _cnt_ws_sql + ') '
                '       OR cv.folder_id IN (SELECT value FROM json_each(?)) '
                '       OR cv.id IN (SELECT value FROM json_each(?))) '
                f'AND {app_module._dms_hidden_sql("cv")} GROUP BY cv.folder_id',
                (uid, *_ws_params, json.dumps(sorted(content_folder_ids)), json.dumps(sorted(shared_doc_ids)))
            ).fetchall()
            own_counts = {
                ('root' if r['folder_id'] is None else str(r['folder_id'])): r['cnt']
                for r in count_rows
            }
        finally:
            conn.row_factory = old_rf

        # Build adjacency list → nested tree
        by_id = {f['id']: {**f, 'children': []} for f in folders}
        roots = []
        for f in by_id.values():
            pid = f.get('parent_id')
            if pid and pid in by_id:
                by_id[pid]['children'].append(f)
            else:
                roots.append(f)

        # Recursive (rolled-up) document counts, computed once over the
        # in-memory tree — a folder's displayed count includes every
        # document nested under any depth of subfolder, not just its own
        # direct children. This is the actual intended behavior (per the
        # Document Vault v2 brief), not a stand-in for a stored count.
        doc_counts = {}
        def _rollup(fid):
            total = own_counts.get(str(fid), 0)
            for child in by_id[fid]['children']:
                total += _rollup(child['id'])
            doc_counts[str(fid)] = total
            return total
        for f in by_id.values():
            if str(f['id']) not in doc_counts:
                _rollup(f['id'])
        doc_counts['root'] = own_counts.get('root', 0)

        return jsonify({'folders': roots, 'flat': folders, 'doc_counts': doc_counts}), 200
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500

@vault_files_bp.route('/folders/<int:folder_id>', methods=['DELETE', 'OPTIONS'])
@jwt_required()
def delete_vault_folder(folder_id):
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        owner_row = app_module.db.execute('SELECT user_id, protected, name FROM vault_folders WHERE id = ?', (folder_id,)).fetchone()
        if not owner_row or not app_module._vault_access_ok('folder', folder_id, owner_row[0], uid, require_edit=True):
            return jsonify({'error': True, 'message': 'Folder not found.'}), 404
        if owner_row[1]:
            return jsonify({'error': True, 'message': 'This is one of the standard blueprint folders and cannot be deleted.'}), 403
        top_folder_name = owner_row[2]

        # Legal hold binds every route that can destroy a document. This check runs BEFORE anything is
        # deleted: one held document anywhere inside stops the whole folder, and nothing is touched.
        held = app_module._dms_legal_hold_titles(folder_id=folder_id)
        if held:
            shown = ', '.join(f'"{t}"' for t in held[:3])
            more = f' and {len(held) - 3} more' if len(held) > 3 else ''
            return jsonify({'error': True, 'message': (
                f'This folder cannot be deleted: {len(held)} document{"s" if len(held) != 1 else ""} inside '
                f'{"are" if len(held) != 1 else "is"} under legal hold ({shown}{more}). '
                'Release the hold in the Document Hub first.')}), 409

        def recursive_delete(fid, fname, fowner, top=False):
            # Delete every document and child folder nested here,
            # unconditionally — the top-level folder's owner/edit-access
            # check already happened once, above, before recursion
            # started, and "delete this folder" (per ConfirmDeleteDialog's
            # own copy: "this folder and everything inside it... will be
            # permanently deleted") means the whole subtree, including a
            # subfolder or document a shared editor created inside it
            # with their own user_id. An earlier, pre-sharing version of
            # this only recursed into folders owned by the deleter (or
            # legacy/NULL), meant to guard against a hypothetical
            # reparenting attack — but every child folder here was only
            # ever nested under fid via a create/move call that itself
            # required access to fid, so that boundary was already
            # enforced at write time; skipping a same-tree child now
            # only orphans it (a real bug this surfaced: a shared
            # editor's own subfolder survived its parent's deletion,
            # left dangling with a parent_id pointing at nothing).
            docs = app_module.db.execute(
                'SELECT id, COALESCE(smart_title, title), user_id FROM case_vault WHERE folder_id = ?', (fid,)
            ).fetchall()
            doc_ids = [d[0] for d in docs]
            if doc_ids:
                doc_ph = ','.join('?' for _ in doc_ids)
                app_module.db.execute(f"DELETE FROM document_vault_shares WHERE node_type = 'document' AND node_id IN ({doc_ph})", doc_ids)
            app_module.db.execute('DELETE FROM case_vault WHERE folder_id = ?', (fid,))
            for doc_id, doc_name, doc_owner in docs:
                app_module._write_provenance(
                    'document', doc_id, doc_name or f'Document {doc_id}', 'deleted', uid,
                    doc_owner if doc_owner is not None else uid,
                    {'reason': 'parent_folder_deleted', 'parent_folder_id': fid}
                )
            child_folders = app_module.db.execute(
                'SELECT id, name, user_id FROM vault_folders WHERE parent_id = ?', (fid,)
            ).fetchall()
            for child_id, child_name, child_owner in child_folders:
                recursive_delete(child_id, child_name, child_owner if child_owner is not None else uid)
            app_module.db.execute("DELETE FROM document_vault_shares WHERE node_type = 'folder' AND node_id = ?", (fid,))
            app_module.db.execute('DELETE FROM vault_folders WHERE id = ?', (fid,))
            app_module._write_provenance(
                'folder', fid, fname, 'deleted', uid, fowner,
                {} if top else {'reason': 'ancestor_folder_deleted'}
            )

        recursive_delete(folder_id, top_folder_name, owner_row[0] if owner_row[0] is not None else uid, top=True)
        app_module.db.commit()
        return jsonify({'success': True, 'deleted_id': folder_id}), 200
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500

# Real multipart file upload into the vault — distinct from /api/vault/save,
# which only ever renders app-generated text content into a blob. This is
# the actual "Upload here" / dropzone target: the caller's own file bytes,
# unmodified, stored in file_blob. No real auto-classification pipeline
# exists anywhere in the app yet (uploads everywhere else in the product
# get a placeholder tag too), so this deliberately doesn't invent one here.
@vault_files_bp.route('/documents/upload', methods=['POST', 'OPTIONS'])
@jwt_required()
def upload_vault_document():
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        if 'file' not in request.files:
            return jsonify({'error': True, 'message': 'No file provided.'}), 400
        f = request.files['file']
        if not f.filename:
            return jsonify({'error': True, 'message': 'No file selected.'}), 400

        folder_id = request.form.get('folder_id') or None
        case_id = request.form.get('case_id') or 'General'
        if folder_id is not None:
            folder_row = app_module.db.execute('SELECT user_id FROM vault_folders WHERE id = ?', (folder_id,)).fetchone()
            if not folder_row or not app_module._vault_access_ok('folder', folder_id, folder_row[0], uid, require_edit=True):
                return jsonify({'error': True, 'message': 'Folder not found.'}), 404

        file_bytes = f.read()
        ext = (f.filename.rsplit('.', 1)[-1] if '.' in f.filename else '').lower()
        title = f.filename.rsplit('.', 1)[0] if '.' in f.filename else f.filename
        from utils import doc_storage  # module-global is shadowed as a create_app local here
        file_bytes = doc_storage.store(file_bytes, ext)  # durable when DOC_STORAGE=disk; unchanged on sqlite

        # Phase 4 scoping: stamp uploads with the active workspace. Older
        # rows (workspace_id = NULL) stay visible in every workspace until
        # Phase 7 migrates them.
        from utils.workspace_scope import current_workspace_id
        _ws_id = current_workspace_id()
        c = app_module.db.cursor()
        c.execute(
            'INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, smart_title, tags, file_blob, file_format, user_id, workspace_id) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (case_id, f.filename, 'uploaded', '', folder_id, title, 'UNCLASSIFIED', file_bytes, ext, uid, _ws_id)
        )
        app_module.db.commit()
        doc_id = c.lastrowid
        app_module._write_provenance(
            'document', doc_id, title, 'uploaded', uid, uid,
            {'filename': f.filename, 'folder_id': folder_id, 'size_bytes': len(file_bytes)}
        )
        # Also hand the file to the Document Hub (text extraction, OCR, search, classification). The
        # row above stays exactly as it was, so this screen is unaffected either way.
        app_module._dms_adopt_best_effort(uid, doc_id)
        return jsonify({
            'success': True,
            'id': doc_id,
            'title': title,
            'filename': f.filename,
            'sizeBytes': len(file_bytes),
            'folder_id': folder_id,
            'tag': 'UNCLASSIFIED',
        }), 201
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500

@vault_files_bp.route('/documents/<int:doc_id>', methods=['DELETE', 'OPTIONS'])
@jwt_required()
def delete_vault_document(doc_id):
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        owner_row = app_module.db.execute(
            'SELECT user_id, COALESCE(smart_title, title) FROM case_vault cv WHERE id = ? AND ' + app_module._dms_hidden_sql('cv'), (doc_id,)
        ).fetchone()
        if not owner_row or not app_module._vault_access_ok('document', doc_id, owner_row[0], uid, require_edit=True):
            return jsonify({'error': True, 'message': 'Document not found.'}), 404
        if app_module._dms_legal_hold_titles(doc_id=doc_id):
            return jsonify({'error': True, 'message': (
                'This document is under legal hold and cannot be deleted. Release the hold in the Document Hub first.')}), 409
        doc_owner_uid = owner_row[0] if owner_row[0] is not None else uid
        doc_name = owner_row[1]
        app_module.db.execute("DELETE FROM document_vault_shares WHERE node_type = 'document' AND node_id = ?", (doc_id,))
        app_module.db.execute('DELETE FROM case_vault WHERE id = ?', (doc_id,))
        app_module.db.commit()
        app_module._write_provenance('document', doc_id, doc_name or f'Document {doc_id}', 'deleted', uid, doc_owner_uid, {})
        return jsonify({'success': True, 'deleted_id': doc_id}), 200
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500

@vault_files_bp.route('/documents/<int:doc_id>/download', methods=['GET', 'OPTIONS'])
@jwt_required()
def download_vault_document(doc_id):
    import app as app_module
    from flask import Response as FlaskResponse
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        row = app_module.db.execute(
            'SELECT file_blob, file_format, smart_title, title, user_id FROM case_vault cv WHERE id = ? AND ' + app_module._dms_hidden_sql('cv'),
            (doc_id,)
        ).fetchone()
        if not row or not app_module._vault_access_ok('document', doc_id, row[4], uid, require_edit=False):
            return jsonify({'error': True, 'message': 'Document not found.'}), 404
        if not row[0] and app_module._dms_present():
            # A file that went in through the Document Hub is kept on disk (checksummed, optionally
            # encrypted), not as a blob in this row - serve it from there, always as a download.
            hub = app_module.db.execute('SELECT store_key, enc, original_name FROM dms_docs WHERE doc_id = ?', (doc_id,)).fetchone()
            if hub:
                from flask import send_file
                from utils import dms_store as _dms_store
                cm = _dms_store.open_plain(hub[0], bool(hub[1]))
                try:
                    path = cm.__enter__()
                except _dms_store.StoreError as exc:
                    return jsonify({'error': True, 'message': str(exc)}), 410
                resp = send_file(path, mimetype='application/octet-stream', as_attachment=True,
                                 download_name=hub[2] or row[2] or row[3] or f'document_{doc_id}', max_age=0)
                resp.headers['X-Content-Type-Options'] = 'nosniff'
                resp.headers['Cache-Control'] = 'private, no-store'
                resp.call_on_close(lambda: cm.__exit__(None, None, None))
                return resp
        if not row[0]:
            return jsonify({'error': True, 'message': 'No binary file stored for this document.'}), 404
        fmt = (row[1] or 'native').lower()
        name = row[2] or row[3] or f'document_{doc_id}'
        # Server-generated exports are always 'pdf' or 'docx' (see
        # /api/vault/save); real uploads (/api/vault/documents/upload)
        # store the caller's own file extension in file_format, which can
        # be anything — mislabeling a .jpg as .docx would corrupt it, so
        # only the two known-generated formats get special-cased mimes.
        _KNOWN_MIMES = {
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }
        mime = _KNOWN_MIMES.get(fmt, 'application/octet-stream')
        ext = f'.{fmt}' if fmt and fmt != 'native' else ''
        safe_name = ''.join(c for c in name if c.isalnum() or c in ' _-.')
        from utils import doc_storage
        _served = doc_storage.resolve(row[0])
        return FlaskResponse(
            _served,
            mimetype=mime,
            headers={'Content-Disposition': f'attachment; filename="{safe_name}{ext}"'},
        )
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500

@vault_files_bp.route('/documents', methods=['GET'])
@jwt_required()
def get_vault_documents():
    import app as app_module
    uid = app_module._current_vault_user_id()
    try:
        q = (request.args.get('q') or '').strip()
        folder_id_param = request.args.get('folder_id')
        try:
            limit = max(1, min(int(request.args.get('limit', 30)), 100))
        except (TypeError, ValueError):
            limit = 30
        try:
            offset = max(0, int(request.args.get('offset', 0)))
        except (TypeError, ValueError):
            offset = 0

        # Phase 4 scoping: restrict own docs to the active workspace when
        # the client sent X-Workspace-Id. Legacy rows (workspace_id IS NULL)
        # stay visible everywhere until Phase 7 migrates them.
        from utils.workspace_scope import current_workspace_id
        _ws = current_workspace_id()
        _owner_cond = (
            '(cv.user_id = ? AND (cv.workspace_id = ? OR cv.workspace_id IS NULL))'
            if _ws is not None else '(cv.user_id = ?)'
        )
        # Never list what is in the Document Hub's trash.
        where_clauses = [_owner_cond, app_module._dms_hidden_sql('cv')]
        params = [uid] + ([_ws] if _ws is not None else [])
        if q:
            like = f'%{q}%'
            where_clauses.append('(cv.title LIKE ? OR cv.content LIKE ? OR cv.case_id LIKE ?)')
            params.extend([like, like, like])
        elif folder_id_param is not None:
            if folder_id_param in ('root', 'null', ''):
                where_clauses.append('cv.folder_id IS NULL')
            else:
                try:
                    where_clauses.append('cv.folder_id = ?')
                    params.append(int(folder_id_param))
                except ValueError:
                    pass
        where_sql = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''

        conn = app_module.db
        old_row_factory = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            c = conn.cursor()
            total = c.execute(
                f"SELECT COUNT(*) FROM case_vault cv {where_sql}", params
            ).fetchone()[0]

            # CRITICAL MEMORY SAFEGUARD: LIMIT/OFFSET is applied in SQL so
            # only one bounded page of rows is ever pulled out of SQLite —
            # `content` can be hundreds of KB per judgment, and this table
            # has 900+ rows, so a plain fetchall() of everything (as the
            # old query did) loads the entire vault's text into Python
            # memory on every request regardless of what's on screen.
            # Every column EXCEPT file_blob: that is raw bytes, which JSON cannot carry (any page
            # containing an uploaded file used to fail with a 500) and which would also pull whole
            # files through memory just to list them. The size is reported instead. Column names
            # come from the table's own schema, never from the request.
            all_cols = [r[1] for r in c.execute("PRAGMA table_info('case_vault')").fetchall()]
            col_sql = ', '.join(f'cv."{col}"' for col in all_cols if col != 'file_blob')
            size_sql = 'LENGTH(cv.file_blob)' if 'file_blob' in all_cols else 'NULL'
            c.execute(
                f"""
                SELECT {col_sql},
                       {size_sql}    AS size_bytes,
                       vf.name       AS folder_name,
                       vf.parent_id  AS folder_parent_id
                FROM   case_vault cv
                LEFT JOIN vault_folders vf ON cv.folder_id = vf.id
                {where_sql}
                ORDER BY cv.created_at DESC
                LIMIT ? OFFSET ?
                """,
                params + [limit, offset]
            )
            rows = c.fetchall()
            dict_rows = []
            for row in rows:
                d = dict(row)
                d['title'] = app_module.resolve_vault_title(d.get('title'), d.get('case_id'), d.get('content'))
                dict_rows.append(d)
        finally:
            conn.row_factory = old_row_factory
        return jsonify({"documents": dict_rows, "total": total, "limit": limit, "offset": offset}), 200
    except Exception as e:
        return jsonify({"error": True, "message": str(e)}), 500

@vault_files_bp.route('/meta', methods=['GET', 'OPTIONS'])
@jwt_required()
def get_vault_meta():
    """Lightweight document metadata for the Save-to-Vault modal explorer
    and the Document Vault tree. Returns id, title, smart_title, doc_type,
    folder_id, file_format, size_bytes, created_at — NO content field, and
    no LIMIT (unlike /api/vault/documents, which pages/caps for its own
    content-bearing use case) since the tree needs every document this
    user can see to render correctly regardless of vault size."""
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        # Content folders only (never the navigation-only ancestors) and folder ids are compared with
        # folder_id, document ids with id: they used to be merged into one set, so sharing folder #N
        # also exposed document #N, and sharing one document exposed its whole folder.
        shared_folder_ids, shared_doc_ids = app_module._visible_shared_vault_ids(uid, include_nav=False)

        conn = app_module.db
        old_rf = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            # Files that went in through the Document Hub keep their bytes on disk, not in the row, so
            # their size comes from the hub. Documents in the hub's trash are not listed.
            if app_module._dms_present():
                size_sql, join_sql = 'COALESCE(LENGTH(cv.file_blob), dd.size)', 'LEFT JOIN dms_docs dd ON dd.doc_id = cv.id'
            else:
                size_sql, join_sql = 'LENGTH(cv.file_blob)', ''
            rows = conn.execute(
                'SELECT cv.id, cv.title, cv.smart_title, cv.doc_type, cv.folder_id, cv.file_format, cv.tags, '
                f'{size_sql} AS size_bytes, cv.created_at '
                f'FROM case_vault cv {join_sql} '
                'WHERE (cv.user_id = ? '
                '       OR cv.folder_id IN (SELECT value FROM json_each(?)) '
                '       OR cv.id IN (SELECT value FROM json_each(?))) '
                f'AND {app_module._dms_hidden_sql("cv")} ORDER BY cv.created_at DESC',
                (uid, json.dumps(sorted(shared_folder_ids)), json.dumps(sorted(shared_doc_ids)))
            ).fetchall()

            share_count_rows = conn.execute(
                "SELECT node_id, COUNT(*) AS cnt FROM document_vault_shares "
                "WHERE node_type = 'document' GROUP BY node_id"
            ).fetchall()
            doc_share_counts = {r['node_id']: r['cnt'] for r in share_count_rows}
            docs = [{**dict(r), 'share_count': doc_share_counts.get(r['id'], 0)} for r in rows]
        finally:
            conn.row_factory = old_rf
        return jsonify({'documents': docs}), 200
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500
