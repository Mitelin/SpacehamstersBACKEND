import math

from py_backend.services.blueprints import add_job, add_material, resolve_material_multipliers


def test_default_material_multipliers_use_sotiyo_nullsec_t1_profile() -> None:
    assert resolve_material_multipliers(None, None, None) == (0.99, 0.958, 0.974)


def test_material_multipliers_map_nullsec_engineering_rig_tiers() -> None:
    assert resolve_material_multipliers("Sotiyo", "T1", None) == (0.99, 0.958, 0.974)
    assert resolve_material_multipliers("Sotiyo", "T2", None) == (0.99, 0.9496, 0.974)


def test_station_material_multipliers_have_no_manufacturing_bonus_without_rig() -> None:
    assert resolve_material_multipliers("station", None, None) == (1.0, 1.0, 0.974)


def test_capital_part_me8_uses_sotiyo_nullsec_t1_facility_bonuses() -> None:
    result = {"materials": []}
    product = {"quantity": 1}
    material = {"materialTypeID": 1, "material": "Capital Part", "quantity": 500, "activityId": 1}
    manufacturing_role_bonus, manufacturing_rig_bonus, reaction_rig_bonus = resolve_material_multipliers(None, None, None)

    qty = add_material(
        result,
        amount=1,
        level=1,
        product=product,
        material=material,
        bp_me=8,
        is_advanced=False,
        manufacturing_role_bonus=manufacturing_role_bonus,
        manufacturing_rig_bonus=manufacturing_rig_bonus,
        reaction_rig_bonus=reaction_rig_bonus,
    )

    assert qty == 437


def test_add_material_rounding_manufacturing_me() -> None:
    result = {"materials": []}
    product = {"quantity": 10}
    material = {"materialTypeID": 1, "material": "Tritanium", "quantity": 37, "activityId": 1}

    qty = add_material(result, amount=10, level=1, product=product, material=material, bp_me=10, is_advanced=False)
    expected = math.ceil((10 * 37 * ((100.0 - 10) / 100.0) * 0.99 * 0.958) / 10)
    assert qty == expected


def test_add_material_triples_datacores() -> None:
    result = {"materials": []}
    product = {"quantity": 1}
    material = {"materialTypeID": 1, "material": "Datacore - Mechanical Engineering", "quantity": 2, "activityId": 8}

    qty = add_material(result, amount=1, level=1, product=product, material=material, bp_me=0, is_advanced=False)

    assert qty == 6
    assert result["materials"][0]["quantity"] == 6


def test_add_job_preserves_lowest_level_for_direct_target() -> None:
    result = {"jobs": []}
    blueprint_product = {
        "blueprintTypeId": 101,
        "blueprint": "Motor Blueprint",
        "time": 60,
        "quantity": 10,
        "productTypeID": 202,
        "product": "Motor",
        "probability": None,
        "maxProductionLimit": 300,
    }

    add_job(result, amount=100, level=1, job_type="Manufacturing", blueprint_product=blueprint_product, bp_te=0, materials=[], is_advanced=False)
    add_job(result, amount=50, level=3, job_type="Manufacturing", blueprint_product=blueprint_product, bp_te=0, materials=[], is_advanced=False)

    assert len(result["jobs"]) == 1
    assert result["jobs"][0]["runs"] == 15
    assert result["jobs"][0]["level"] == 1
    assert result["jobs"][0]["runs"] * result["jobs"][0]["quantity"] == 150


def test_add_job_keeps_distinct_invention_outputs_separate() -> None:
    result = {"jobs": []}
    fury_blueprint_product = {
        "blueprintTypeId": 501,
        "blueprint": "Inferno Cruise Missile Blueprint",
        "time": 60,
        "quantity": 10,
        "productTypeID": 601,
        "product": "Inferno Fury Cruise Missile Blueprint",
        "probability": None,
        "maxProductionLimit": 300,
    }
    precision_blueprint_product = {
        "blueprintTypeId": 501,
        "blueprint": "Inferno Cruise Missile Blueprint",
        "time": 60,
        "quantity": 10,
        "productTypeID": 602,
        "product": "Inferno Precision Cruise Missile Blueprint",
        "probability": None,
        "maxProductionLimit": 300,
    }

    add_job(result, amount=1200, level=9, job_type="Invention", blueprint_product=fury_blueprint_product, bp_te=0, materials=[], is_advanced=False)
    add_job(result, amount=1200, level=9, job_type="Invention", blueprint_product=precision_blueprint_product, bp_te=0, materials=[], is_advanced=False)

    assert len(result["jobs"]) == 2
    assert {job["product"] for job in result["jobs"]} == {
        "Inferno Fury Cruise Missile Blueprint",
        "Inferno Precision Cruise Missile Blueprint",
    }
