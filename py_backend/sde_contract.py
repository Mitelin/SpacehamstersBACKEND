from __future__ import annotations

"""SDE schema contract.

This module defines the minimal subset of SDE tables/columns that the current
backend implementation relies on via SQL queries.

The goal is to keep the future JSONL->SQL importer honest: if code starts using
additional SDE columns/tables, tests should fail until the contract (and
importer) is updated.
"""

from typing import Final


# Minimal set of SDE tables and the columns that are referenced by the backend.
# Column name comparisons should be treated case-insensitively by callers.
REQUIRED_SDE_SCHEMA: Final[dict[str, set[str]]] = {
    # Type dictionary + grouping
    "invTypes": {"typeID", "typeName", "groupID", "portionSize"},
    "invGroups": {"groupID", "groupName", "categoryID"},
    "invCategories": {"categoryID", "categoryName"},

    # Blueprint/industry
    "industryBlueprints": {"typeID", "maxProductionLimit"},
    "industryActivity": {"typeID", "activityID", "time"},
    "industryActivityProducts": {"typeID", "activityID", "productTypeID", "quantity"},
    "industryActivityMaterials": {"typeID", "activityID", "materialTypeID", "quantity"},
    "industryActivityProbabilities": {"typeID", "activityID", "productTypeID", "probability"},

    # Materials / meta
    "invTypeMaterials": {"typeID", "materialTypeID", "quantity"},
    "invMetaTypes": {"typeID", "metaGroupID"},
}


SDE_TABLE_PREFIXES: Final[tuple[str, ...]] = ("inv", "industry")
