import os
import zcatalyst_sdk
from flask import Request, jsonify, make_response

TABLE_NAME = "Uploads"

def _json(status: int, payload: dict):
    return make_response(jsonify(payload), status)

def handler(request: Request):
    try:
        app = zcatalyst_sdk.initialize()

        folder_id = os.environ.get("FILESTORE_FOLDER_ID")
        if not folder_id:
            return _json(500, {"ok": False, "error": "Missing env var FILESTORE_FOLDER_ID in function settings"})

        # GET: return latest rows
        if request.method == "GET":
            zcql = app.zcql()
            query = (
                f"SELECT ROWID, file_name, file_id, file_size, CREATEDTIME "
                f"FROM {TABLE_NAME} ORDER BY CREATEDTIME DESC LIMIT 25"
            )
            rows = zcql.execute_query(query)

            cleaned = []
            for r in rows:
                if isinstance(r, dict) and TABLE_NAME in r:
                    cleaned.append(r[TABLE_NAME])
                else:
                    cleaned.append(r)

            return _json(200, {"ok": True, "count": len(cleaned), "data": cleaned})

        # POST: accept multipart upload "file"
        if request.method == "POST":
            if "file" not in request.files:
                return _json(400, {"ok": False, "error": "No file part. Use form-data key: file"})

            f = request.files["file"]
            if not f or not f.filename:
                return _json(400, {"ok": False, "error": "Empty filename"})

            # Upload to File Store
            filestore = app.filestore()
            folder = filestore.folder(int(folder_id))

            # Catalyst Python SDK expects a file-like object opened in 'rb'
            # Flask gives file as a stream already (f.stream)
            uploaded = folder.upload_file(f.filename, f.stream)

            file_id = uploaded.get("id") if isinstance(uploaded, dict) else None
            file_size = None
            if isinstance(uploaded, dict):
                file_size = uploaded.get("file_size")

            if not file_id:
                return _json(500, {"ok": False, "error": "Upload succeeded but no file id returned", "raw": uploaded})

            # Insert metadata to Data Store
            datastore = app.datastore()
            table = datastore.table(TABLE_NAME)

            row_data = {
                "file_name": f.filename,
                "file_id": file_id,
                "file_size": int(file_size) if file_size else int(request.content_length or 0),
            }
            inserted = table.insert_row(row_data)

            return _json(200, {"ok": True, "file": uploaded, "row": inserted})

        return _json(405, {"ok": False, "error": "Method not allowed"})

    except Exception as e:
        return _json(500, {"ok": False, "error": str(e)})
