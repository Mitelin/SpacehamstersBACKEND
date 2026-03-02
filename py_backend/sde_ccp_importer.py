from __future__ import annotations

import json
import pathlib
from typing import Any


CCP_SDE_VERSION_FILE = "_sde.jsonl"


MINIMAL_SDE_TABLES: set[str] = {
    "invCategories",
    "invGroups",
    "invTypes",
    "invMetaTypes",
    "industryBlueprints",
    "industryActivity",
    "industryActivityProducts",
    "industryActivityMaterials",
    "industryActivityProbabilities",
    "invTypeMaterials",
    "sdeVersion",
}


CCP_ACTIVITY_NAME_TO_ID: dict[str, int] = {
    "manufacturing": 1,
    "research_time": 3,
    "research_material": 4,
    "copying": 5,
    "invention": 8,
    # ESI uses 11 for reactions; existing backend joins on (1, 11)
    "reaction": 11,
    "reactions": 11,
}


def _name_en(name_field: Any) -> str:
    if isinstance(name_field, dict):
        v = name_field.get("en")
        if v is None:
            # fallback: any language
            for vv in name_field.values():
                if isinstance(vv, str) and vv.strip():
                    return vv
        return str(v or "")
    return str(name_field or "")


def _iter_jsonl(path: pathlib.Path):
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            yield json.loads(s)


def read_ccp_sde_build_info(ccp_dir: pathlib.Path) -> dict[str, Any]:
    version_path = ccp_dir / CCP_SDE_VERSION_FILE
    if not version_path.exists():
        raise RuntimeError(f"Missing CCP SDE version file: {version_path}")

    first = next(_iter_jsonl(version_path), None)
    if not isinstance(first, dict):
        raise RuntimeError(f"Invalid CCP SDE version file: {version_path}")
    build_number = first.get("buildNumber")
    release_date = first.get("releaseDate")
    if build_number is None:
        raise RuntimeError(f"CCP SDE version file missing buildNumber: {version_path}")

    return {"buildNumber": int(build_number), "releaseDate": str(release_date) if release_date else None}


async def _exec(conn, sql: str, params: tuple[Any, ...] = ()) -> None:
    async with conn.cursor() as cur:
        await cur.execute(sql, params)


async def _fetch_one(conn, sql: str, params: tuple[Any, ...] = ()) -> tuple[Any, ...] | None:
    async with conn.cursor() as cur:
        await cur.execute(sql, params)
        return await cur.fetchone()


async def _executemany(conn, sql: str, rows: list[tuple[Any, ...]]) -> None:
    if not rows:
        return
    async with conn.cursor() as cur:
        await cur.executemany(sql, rows)


async def ensure_sde_version_table(conn) -> None:
    await _exec(
        conn,
        """
        CREATE TABLE IF NOT EXISTS sdeVersion (
          source VARCHAR(32) NOT NULL,
          buildNumber BIGINT NOT NULL,
          releaseDate VARCHAR(32) NULL,
          importedAt DATETIME NOT NULL,
          PRIMARY KEY (source)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
    )


async def get_imported_build_number(conn, source: str = "ccp_jsonl") -> int | None:
    try:
        row = await _fetch_one(conn, "SELECT buildNumber FROM sdeVersion WHERE source=%s", (source,))
    except Exception as exc:
        # First run: table doesn't exist yet.
        # MySQL error: 1146 (ER_NO_SUCH_TABLE)
        try:
            if getattr(exc, "args", None) and exc.args and int(exc.args[0]) == 1146:
                return None
        except Exception:
            pass
        raise
    if not row:
        return None
    try:
        return int(row[0])
    except Exception:
        return None


async def set_imported_build_number(
    conn,
    *,
    build_number: int,
    release_date: str | None,
    source: str = "ccp_jsonl",
) -> None:
    # Use UTC NOW() from DB server to avoid timezone ambiguity.
    await _exec(
        conn,
        """
        INSERT INTO sdeVersion (source, buildNumber, releaseDate, importedAt)
        VALUES (%s, %s, %s, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE buildNumber=VALUES(buildNumber), releaseDate=VALUES(releaseDate), importedAt=VALUES(importedAt)
        """.strip(),
        (source, int(build_number), release_date),
    )


async def ensure_minimal_sde_schema(conn) -> None:
    # Minimal tables/columns required by current backend.
    stmts = [
        """
        CREATE TABLE IF NOT EXISTS invCategories (
          categoryID INT NOT NULL,
          categoryName VARCHAR(255) NOT NULL,
          PRIMARY KEY (categoryID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS invGroups (
          groupID INT NOT NULL,
          groupName VARCHAR(255) NOT NULL,
          categoryID INT NOT NULL,
          PRIMARY KEY (groupID),
          KEY idx_invGroups_categoryID (categoryID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS invTypes (
          typeID INT NOT NULL,
          typeName VARCHAR(255) NOT NULL,
          groupID INT NOT NULL,
          portionSize INT NOT NULL DEFAULT 1,
          PRIMARY KEY (typeID),
          KEY idx_invTypes_groupID (groupID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS invMetaTypes (
          typeID INT NOT NULL,
          metaGroupID INT NOT NULL,
          PRIMARY KEY (typeID),
          KEY idx_invMetaTypes_metaGroupID (metaGroupID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS industryBlueprints (
          typeID INT NOT NULL,
          maxProductionLimit INT NOT NULL,
          PRIMARY KEY (typeID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS industryActivity (
          typeID INT NOT NULL,
          activityID INT NOT NULL,
          time INT NOT NULL,
          PRIMARY KEY (typeID, activityID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS industryActivityProducts (
          typeID INT NOT NULL,
          activityID INT NOT NULL,
          productTypeID INT NOT NULL,
          quantity INT NOT NULL,
          PRIMARY KEY (typeID, activityID, productTypeID),
          KEY idx_indActProd_productTypeID (productTypeID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS industryActivityMaterials (
          typeID INT NOT NULL,
          activityID INT NOT NULL,
          materialTypeID INT NOT NULL,
          quantity INT NOT NULL,
          PRIMARY KEY (typeID, activityID, materialTypeID),
          KEY idx_indActMat_materialTypeID (materialTypeID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS industryActivityProbabilities (
          typeID INT NOT NULL,
          activityID INT NOT NULL,
          productTypeID INT NOT NULL,
          probability DOUBLE NOT NULL,
          PRIMARY KEY (typeID, activityID, productTypeID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
        """
        CREATE TABLE IF NOT EXISTS invTypeMaterials (
          typeID INT NOT NULL,
          materialTypeID INT NOT NULL,
          quantity INT NOT NULL,
          PRIMARY KEY (typeID, materialTypeID),
          KEY idx_invTypeMaterials_materialTypeID (materialTypeID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """.strip(),
    ]
    for stmt in stmts:
        await _exec(conn, stmt)


async def import_inv_categories(conn, ccp_dir: pathlib.Path, *, chunk_size: int = 1000) -> None:
    path = ccp_dir / "categories.jsonl"
    rows: list[tuple[Any, ...]] = []
    sql = (
        "INSERT INTO invCategories (categoryID, categoryName) VALUES (%s,%s) "
        "ON DUPLICATE KEY UPDATE categoryName=VALUES(categoryName)"
    )
    for obj in _iter_jsonl(path):
        if not isinstance(obj, dict):
            continue
        category_id = int(obj.get("_key"))
        category_name = _name_en(obj.get("name"))
        rows.append((category_id, category_name))
        if len(rows) >= chunk_size:
            await _executemany(conn, sql, rows)
            rows = []
    if rows:
        await _executemany(conn, sql, rows)


async def import_inv_groups(conn, ccp_dir: pathlib.Path, *, chunk_size: int = 2000) -> None:
    path = ccp_dir / "groups.jsonl"
    rows: list[tuple[Any, ...]] = []
    sql = (
        "INSERT INTO invGroups (groupID, groupName, categoryID) VALUES (%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE groupName=VALUES(groupName), categoryID=VALUES(categoryID)"
    )
    for obj in _iter_jsonl(path):
        if not isinstance(obj, dict):
            continue
        group_id = int(obj.get("_key"))
        category_id = int(obj.get("categoryID") or 0)
        group_name = _name_en(obj.get("name"))
        rows.append((group_id, group_name, category_id))
        if len(rows) >= chunk_size:
            await _executemany(conn, sql, rows)
            rows = []
    if rows:
        await _executemany(conn, sql, rows)


async def import_inv_types_and_meta(conn, ccp_dir: pathlib.Path, *, chunk_size: int = 1000) -> None:
    path = ccp_dir / "types.jsonl"

    type_rows: list[tuple[Any, ...]] = []
    meta_rows: list[tuple[Any, ...]] = []

    type_sql = (
        "INSERT INTO invTypes (typeID, typeName, groupID, portionSize) VALUES (%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE typeName=VALUES(typeName), groupID=VALUES(groupID), portionSize=VALUES(portionSize)"
    )
    meta_sql = (
        "INSERT INTO invMetaTypes (typeID, metaGroupID) VALUES (%s,%s) "
        "ON DUPLICATE KEY UPDATE metaGroupID=VALUES(metaGroupID)"
    )

    for obj in _iter_jsonl(path):
        if not isinstance(obj, dict):
            continue
        type_id = int(obj.get("_key"))
        group_id = int(obj.get("groupID") or 0)
        type_name = _name_en(obj.get("name"))
        portion_size = int(obj.get("portionSize") or 1)
        type_rows.append((type_id, type_name, group_id, portion_size))

        meta_group_id = obj.get("metaGroupID")
        if meta_group_id is not None:
            meta_rows.append((type_id, int(meta_group_id)))

        if len(type_rows) >= chunk_size:
            await _executemany(conn, type_sql, type_rows)
            type_rows = []
        if len(meta_rows) >= chunk_size:
            await _executemany(conn, meta_sql, meta_rows)
            meta_rows = []

    if type_rows:
        await _executemany(conn, type_sql, type_rows)
    if meta_rows:
        await _executemany(conn, meta_sql, meta_rows)


async def import_blueprints_industry(conn, ccp_dir: pathlib.Path, *, chunk_size: int = 2000) -> None:
    path = ccp_dir / "blueprints.jsonl"

    bp_rows: list[tuple[Any, ...]] = []
    act_rows: list[tuple[Any, ...]] = []
    prod_rows: list[tuple[Any, ...]] = []
    prob_rows: list[tuple[Any, ...]] = []
    mat_rows: list[tuple[Any, ...]] = []

    bp_sql = (
        "INSERT INTO industryBlueprints (typeID, maxProductionLimit) VALUES (%s,%s) "
        "ON DUPLICATE KEY UPDATE maxProductionLimit=VALUES(maxProductionLimit)"
    )
    act_sql = (
        "INSERT INTO industryActivity (typeID, activityID, time) VALUES (%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE time=VALUES(time)"
    )
    prod_sql = (
        "INSERT INTO industryActivityProducts (typeID, activityID, productTypeID, quantity) VALUES (%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)"
    )
    prob_sql = (
        "INSERT INTO industryActivityProbabilities (typeID, activityID, productTypeID, probability) VALUES (%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE probability=VALUES(probability)"
    )
    mat_sql = (
        "INSERT INTO industryActivityMaterials (typeID, activityID, materialTypeID, quantity) VALUES (%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)"
    )

    def _flush_if_needed() -> bool:
        return (
            len(bp_rows) >= chunk_size
            or len(act_rows) >= chunk_size
            or len(prod_rows) >= chunk_size
            or len(prob_rows) >= chunk_size
            or len(mat_rows) >= chunk_size
        )

    async def _flush() -> None:
        nonlocal bp_rows, act_rows, prod_rows, prob_rows, mat_rows
        if bp_rows:
            await _executemany(conn, bp_sql, bp_rows)
            bp_rows = []
        if act_rows:
            await _executemany(conn, act_sql, act_rows)
            act_rows = []
        if prod_rows:
            await _executemany(conn, prod_sql, prod_rows)
            prod_rows = []
        if prob_rows:
            await _executemany(conn, prob_sql, prob_rows)
            prob_rows = []
        if mat_rows:
            await _executemany(conn, mat_sql, mat_rows)
            mat_rows = []

    for obj in _iter_jsonl(path):
        if not isinstance(obj, dict):
            continue
        type_id = int(obj.get("blueprintTypeID") or obj.get("_key"))
        max_prod = int(obj.get("maxProductionLimit") or 0)
        bp_rows.append((type_id, max_prod))

        activities = obj.get("activities")
        if not isinstance(activities, dict):
            continue
        for name, data in activities.items():
            activity_id = CCP_ACTIVITY_NAME_TO_ID.get(str(name))
            if activity_id is None:
                continue
            if not isinstance(data, dict):
                continue
            time_s = int(data.get("time") or 0)
            act_rows.append((type_id, activity_id, time_s))

            materials = data.get("materials")
            if isinstance(materials, list):
                for m in materials:
                    if not isinstance(m, dict):
                        continue
                    mid = m.get("typeID")
                    if mid is None:
                        continue
                    mat_rows.append((type_id, activity_id, int(mid), int(m.get("quantity") or 0)))

            products = data.get("products")
            if isinstance(products, list):
                for p in products:
                    if not isinstance(p, dict):
                        continue
                    pid = p.get("typeID")
                    if pid is None:
                        continue
                    product_type_id = int(pid)
                    qty = int(p.get("quantity") or 1)
                    prod_rows.append((type_id, activity_id, product_type_id, qty))
                    if p.get("probability") is not None:
                        prob_rows.append((type_id, activity_id, product_type_id, float(p.get("probability"))))

        if _flush_if_needed():
            await _flush()

    await _flush()


async def import_type_materials(conn, ccp_dir: pathlib.Path, *, chunk_size: int = 4000) -> None:
    path = ccp_dir / "typeMaterials.jsonl"
    rows: list[tuple[Any, ...]] = []
    sql = (
        "INSERT INTO invTypeMaterials (typeID, materialTypeID, quantity) VALUES (%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)"
    )

    for obj in _iter_jsonl(path):
        if not isinstance(obj, dict):
            continue
        type_id = int(obj.get("_key"))
        materials = obj.get("materials")
        if not isinstance(materials, list):
            continue
        for m in materials:
            if not isinstance(m, dict):
                continue
            rows.append((type_id, int(m.get("materialTypeID")), int(m.get("quantity") or 0)))
            if len(rows) >= chunk_size:
                await _executemany(conn, sql, rows)
                rows = []
    if rows:
        await _executemany(conn, sql, rows)


async def import_minimal_sde_from_ccp_jsonl(conn, ccp_dir: pathlib.Path) -> dict[str, Any]:
    """Import minimal SDE tables from CCP JSONL export.

    Returns build info dict: {buildNumber:int, releaseDate:str|None}
    """

    ccp_dir = ccp_dir.expanduser().resolve()
    if not ccp_dir.exists():
        raise RuntimeError(f"CCP SDE directory not found: {ccp_dir}")

    build = read_ccp_sde_build_info(ccp_dir)

    await ensure_sde_version_table(conn)
    await ensure_minimal_sde_schema(conn)

    # Load dimension tables first
    await import_inv_categories(conn, ccp_dir)
    await import_inv_groups(conn, ccp_dir)
    await import_inv_types_and_meta(conn, ccp_dir)

    # Industry tables
    await import_blueprints_industry(conn, ccp_dir)
    await import_type_materials(conn, ccp_dir)

    await set_imported_build_number(conn, build_number=int(build["buildNumber"]), release_date=build.get("releaseDate"))
    return build
