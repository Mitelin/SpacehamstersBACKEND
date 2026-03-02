from __future__ import annotations

import math
from typing import Any

from .. import db
from ..logger import log


async def get_blueprint_products(type_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        """
        SELECT
            dur.activityId
        ,   bpo.typeId as blueprintTypeId
        ,   bpo.typeName as blueprint
        ,   dur.time
        ,   prd.quantity
        ,   prd.productTypeID
        ,   prdt.typeName as product
        ,   prdg.groupID productGroupId
        ,   prdg.categoryID productCategoryId
        ,   limits.maxProductionLimit
        ,   prob.probability
        ,   NVL(mt.metaGroupID, 1) metaGroupID
        FROM invTypes bpo
        JOIN industryActivity dur on dur.typeId = bpo.typeId
        JOIN industryActivityProducts prd on prd.typeId = bpo.typeId and prd.activityId = dur.activityId
        LEFT JOIN industryActivityProbabilities prob on prob.typeID = bpo.typeID and prob.activityID = dur.activityID and prob.productTypeID = prd.productTypeID
        JOIN industryBlueprints limits on limits.typeID = bpo.typeID
        JOIN invTypes prdt on prdt.typeId = prd.productTypeID
        JOIN invGroups prdg on prdg.groupID = prdt.groupID
        LEFT JOIN invMetaTypes mt on mt.typeID = prd.productTypeID
        WHERE bpo.typeId = %s
        """,
        [type_id],
    )
    return rows


async def get_blueprint_source(type_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        """
        SELECT
            dur.activityId
        ,   bpo.typeId as blueprintTypeId
        ,   bpo.typeName as blueprint
        ,   dur.time
        ,   prd.quantity
        ,   prd.productTypeID
        ,   prdt.typeName as product
        ,   prdg.groupID productGroupId
        ,   prdg.categoryID productCategoryId
        ,   limits.maxProductionLimit
        ,   prob.probability
        ,   NVL(mt.metaGroupID, 1) metaGroupID
        FROM invTypes bpo
        JOIN industryActivity dur on dur.typeId = bpo.typeId
        JOIN industryActivityProducts prd on prd.typeId = bpo.typeId and prd.activityId = dur.activityId
        LEFT JOIN industryActivityProbabilities prob on prob.typeID = bpo.typeID and prob.activityID = dur.activityID and prob.productTypeID = prd.productTypeID
        JOIN industryBlueprints limits on limits.typeID = bpo.typeID
        JOIN invTypes prdt on prdt.typeId = prd.productTypeID
        JOIN invGroups prdg on prdg.groupID = prdt.groupID
        LEFT JOIN invMetaTypes mt on mt.typeID = prd.productTypeID
        WHERE prd.productTypeID = %s
        """,
        [type_id],
    )
    return rows


async def get_blueprint_material(type_id: int) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        """
        SELECT
            mat.activityId
        ,   mat.materialTypeID
        ,   matt.typeName material
        ,   matt.groupID materialGroupId
        ,   matg.categoryID materialCategoryId
        ,   mat.quantity
        ,   prd.typeId blueprintTypeId
        ,   prdt.typeName as blueprint
        ,   prd.quantity as blueprintQuantity
        FROM industryActivityMaterials mat
        JOIN invTypes matt on matt.typeId = mat.materialTypeID
        JOIN invGroups matg on matg.groupID = matt.groupID
        LEFT JOIN industryActivityProducts prd on prd.productTypeID = mat.materialTypeID
        LEFT JOIN invTypes prdt on prdt.typeId = prd.typeId
        WHERE mat.typeId = %s
        AND (prdt.typeName IS NULL OR prdt.typeName not like 'Test%%')
        """,
        [type_id],
    )
    return rows


async def get_ore_minerals(type_name: str) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        """
        SELECT o.portionSize, m.quantity, mat.typeName
        FROM invTypes o
        JOIN invTypeMaterials m on m.typeID = o.typeID
        JOIN invTypes mat on mat.typeID = m.materialTypeID
        where o.typeName = %s
        """,
        [type_name],
    )
    return rows


def add_job(
    result: dict[str, Any],
    amount: int,
    level: int,
    job_type: str,
    blueprint_product: dict[str, Any],
    bp_te: int,
    materials: list[dict[str, Any]] | None,
    is_advanced: bool,
) -> int:
    existing = next(
        (
            j
            for j in result["jobs"]
            if j["blueprintTypeId"] == blueprint_product["blueprintTypeId"] and j["type"] == job_type
        ),
        None,
    )

    runs = int(math.ceil(amount / blueprint_product["quantity"]))

    base_time = blueprint_product["time"]
    if job_type == "Manufacturing":
        time = int(math.ceil(base_time * ((100 - bp_te) / 100) * (1 - 0.15) * (1 - 0.2 * 2.1)))
    elif job_type == "Invention":
        time = int(math.ceil(base_time * (1 - 0.15) * (1 - 0.2 * 2.1)))
    elif job_type == "Reaction":
        time = int(math.ceil(base_time * (1 - 0.25) * (1 - 0.2 * 2.1)))
    else:
        time = int(math.ceil(base_time * 0.8))

    if existing:
        existing["runs"] += runs
        if existing["level"] < level:
            existing["level"] = level
        if materials:
            for i in range(len(materials)):
                existing["materials"][i]["quantity"] += materials[i]["quantity"]
        return runs

    result["jobs"].append(
        {
            "level": level,
            "type": job_type,
            "blueprintTypeId": blueprint_product["blueprintTypeId"],
            "blueprint": blueprint_product["blueprint"],
            "runs": runs,
            "time": time,
            "quantity": blueprint_product["quantity"],
            "productTypeID": blueprint_product["blueprintTypeId"]
            if job_type == "Copying"
            else blueprint_product["productTypeID"],
            "product": blueprint_product["blueprint"] if job_type == "Copying" else blueprint_product["product"],
            "materials": materials,
            "probability": blueprint_product.get("probability"),
            "isAdvanced": is_advanced,
            "maxProductionLimit": blueprint_product.get("maxProductionLimit"),
        }
    )
    return runs


def add_material(
    result: dict[str, Any],
    amount: int,
    level: int,
    product: dict[str, Any],
    material: dict[str, Any],
    bp_me: int,
    is_advanced: bool,
) -> int:
    existing = next(
        (m for m in result["materials"] if m["materialTypeID"] == material["materialTypeID"]),
        None,
    )

    if material["quantity"] == 1:
        quantity = int(math.ceil((amount * material["quantity"]) / product["quantity"]))
    elif material["activityId"] == 1:
        quantity = int(
            math.ceil(
                (
                    amount
                    * material["quantity"]
                    * ((100.0 - float(bp_me)) / 100.0)
                    * 0.99
                    * 0.958
                )
                / product["quantity"]
            )
        )
    else:
        quantity = int(math.ceil((amount * material["quantity"] * 0.974) / product["quantity"]))

    quantity_basic_manufacture = quantity if (material["activityId"] == 1 and not is_advanced) else 0
    quantity_advanced_manufacture = quantity if (material["activityId"] == 1 and is_advanced) else 0
    quantity_basic_reaction = quantity if (material["activityId"] == 11 and not is_advanced) else 0
    quantity_advanced_reaction = quantity if (material["activityId"] == 11 and is_advanced) else 0

    if existing:
        existing["quantity"] += quantity
        existing["quantityBasicManufacture"] += quantity_basic_manufacture
        existing["quantityAdvancedManufacture"] += quantity_advanced_manufacture
        existing["quantityBasicReaction"] += quantity_basic_reaction
        existing["quantityAdvancedReaction"] += quantity_advanced_reaction
        if existing["level"] < level:
            existing["level"] = level
        return quantity

    result["materials"].append(
        {
            "materialTypeID": material["materialTypeID"],
            "material": material["material"],
            "quantity": quantity,
            "quantityBasicManufacture": quantity_basic_manufacture,
            "quantityAdvancedManufacture": quantity_advanced_manufacture,
            "quantityBasicReaction": quantity_basic_reaction,
            "quantityAdvancedReaction": quantity_advanced_reaction,
            "level": level,
            "activityId": material["activityId"],
            "isInput": False if material.get("blueprintTypeId") else True,
        }
    )
    return quantity


def add_module(result: dict[str, Any], amount: int, level: int, type_id: int, activity_id: int) -> None:
    # Mirrors current Node logic (no real merging; important for ceil/rounding parity).
    if level > 1:
        _m = next((m for m in result["modules"] if m["typeId"] == type_id), None)
        # Node has a shadowed variable bug here; we intentionally do not use _m.

    result["modules"].append({"level": level, "typeId": type_id, "activityId": activity_id, "amount": amount})


async def process_blueprint(
    result: dict[str, Any],
    amount: int,
    level: int,
    product: dict[str, Any],
    materials: list[dict[str, Any]],
    activity_id: int,
    typeme: int,
    typete: int,
    copy_bpo: bool,
    produce_fuel_blocks: bool,
) -> dict[str, Any]:
    materials_job: list[dict[str, Any]] = []
    materials_copy: list[dict[str, Any]] = []

    add_copy_job = (
        ((activity_id == 1 and product["metaGroupID"] == 1) or (activity_id == 8 and product["metaGroupID"] == 2))
        and copy_bpo
    )

    is_advanced = False
    for element in materials:
        if element["activityId"] == activity_id:
            if element.get("materialGroupId") == 1136 and not produce_fuel_blocks:
                element.pop("blueprintTypeId", None)
            if element.get("blueprintTypeId"):
                is_advanced = True

    for e in list(materials):
        if (
            e["materialTypeID"] == product["blueprintTypeId"]
            and product["metaGroupID"] == 2
            and product["activityId"] == 1
        ):
            blueprint_source = await get_blueprint_source(e["materialTypeID"])
            if blueprint_source:
                qty = int(math.ceil(amount / blueprint_source[0]["quantity"]))
                add_module(result, qty, 1, int(blueprint_source[0]["blueprintTypeId"]), 8)

        if (e["activityId"] == activity_id) or (copy_bpo and (e["activityId"] == 5) and product["metaGroupID"] == 1):
            quantity = add_material(result, amount, level, product, e, typeme, is_advanced)

            if e["activityId"] == activity_id:
                if e.get("blueprintTypeId"):
                    add_module(result, quantity, level + 1, int(e["blueprintTypeId"]), int(e["activityId"]))
                materials_job.append({"type": e["material"], "quantity": quantity, "base_quantity": e["quantity"]})
            else:
                if e.get("blueprintTypeId"):
                    add_module(result, quantity, 11, int(e["blueprintTypeId"]), 1)
                materials_copy.append({"type": e["material"], "quantity": quantity, "base_quantity": e["quantity"]})

    if add_copy_job:
        element_copy = {
            "activityId": 5,
            "materialTypeID": product["blueprintTypeId"],
            "material": product["blueprint"],
            "blueprintTypeId": product["blueprintTypeId"],
            "quantity": 1,
        }
        copy_quantity = int(math.ceil(amount / product["maxProductionLimit"]))
        add_material(result, copy_quantity, 10, product, element_copy, 0, False)
        materials_job.append({"type": element_copy["material"], "quantity": copy_quantity})

    if product["activityId"] == 1:
        runs = add_job(result, amount, level, "Manufacturing", product, typete, materials_job, is_advanced)
        if add_copy_job:
            add_job(result, runs, 12 if (level > 10) else 10, "Copying", product, typete, materials_copy, False)
    elif product["activityId"] == 8:
        runs = add_job(result, amount, 9, "Invention", product, typete, materials_job, False)
        if add_copy_job:
            add_job(result, runs, 10, "Copying", product, typete, materials_copy, False)
    elif product["activityId"] == 11:
        add_job(result, amount, level, "Reaction", product, 0, materials_job, is_advanced)

    return result


async def get_blueprints_details(
    types: list[dict[str, Any]],
    efficiency: dict[str, Any],
    build_t1: bool,
    copy_bpo: bool,
    produce_fuel_blocks: bool,
) -> dict[str, Any]:
    result: dict[str, Any] = {"jobs": [], "materials": [], "modules": []}

    log(2, "blueprints.getBlueprintsDetails()")

    for t in types:
        add_module(result, int(t["amount"]), 1, int(t["typeId"]), 1)

    while result["modules"]:
        module = result["modules"].pop(0)
        blueprint_products = await get_blueprint_products(int(module["typeId"]))

        for element in list(blueprint_products):
            if (
                element["activityId"] == module["activityId"]
                or (module["activityId"] == 1 and element["activityId"] == 11)
                or (module["activityId"] == 11 and element["activityId"] == 1)
                or (module["level"] == 2 and element["activityId"] == 8)
            ):
                blueprint_product = element
                amount = int(math.ceil(int(module["amount"]) / blueprint_product["quantity"]) * blueprint_product["quantity"])
                level = int(module["level"])

                blueprint_material = await get_blueprint_material(int(module["typeId"]))

                if blueprint_product["productCategoryId"] == 6:
                    if blueprint_product["metaGroupID"] == 1:
                        me = int(efficiency.get("shipT1ME") or 0)
                        te = int(efficiency.get("shipT1TE") or 0)
                    else:
                        me = int(efficiency.get("shipT2ME") or 0)
                        te = int(efficiency.get("shipT2TE") or 0)
                else:
                    if blueprint_product["metaGroupID"] == 1:
                        me = int(efficiency.get("moduleT1ME") or 0)
                        te = int(efficiency.get("moduleT1TE") or 0)
                    else:
                        me = int(efficiency.get("moduleT2ME") or 0)
                        te = int(efficiency.get("moduleT2TE") or 0)

                if blueprint_product["productCategoryId"] == 6:
                    if (not build_t1) and (not any(x.get("typeId") == blueprint_product["blueprintTypeId"] for x in types)):
                        continue

                if blueprint_product["activityId"] == 8:
                    if not any(x.get("typeId") == blueprint_product["productTypeID"] for x in types):
                        continue

                if blueprint_product["metaGroupID"] == 2:
                    blueprint_material.append(
                        {
                            "materialTypeID": blueprint_product["blueprintTypeId"],
                            "activityId": 1,
                            "material": blueprint_product["blueprint"],
                            "quantity": 1,
                        }
                    )

                await process_blueprint(
                    result,
                    amount,
                    level,
                    blueprint_product,
                    blueprint_material,
                    blueprint_product["activityId"],
                    me,
                    te,
                    copy_bpo,
                    produce_fuel_blocks,
                )

    result.pop("modules", None)
    log(1, "blueprints.getBlueprintsDetails finished")
    return result


async def get_blueprint_details(
    type_id: int,
    amount: int,
    efficiency: dict[str, Any],
    build_t1: bool,
    copy_bpo: bool,
    produce_fuel_blocks: bool,
) -> dict[str, Any]:
    return await get_blueprints_details(
        types=[{"typeId": int(type_id), "amount": int(amount)}],
        efficiency=efficiency,
        build_t1=build_t1,
        copy_bpo=copy_bpo,
        produce_fuel_blocks=produce_fuel_blocks,
    )


async def get_ore_details(type_name: str) -> list[dict[str, Any]]:
    log(2, f"blueprints.getOreDetails ({type_name})")
    rows = await get_ore_minerals(type_name)
    return rows
