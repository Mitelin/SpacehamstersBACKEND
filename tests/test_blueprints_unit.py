import math

from py_backend.services.blueprints import add_job, add_material


def test_add_material_rounding_manufacturing_me() -> None:
    result = {"materials": []}
    product = {"quantity": 10}
    material = {"materialTypeID": 1, "material": "Tritanium", "quantity": 37, "activityId": 1}

    qty = add_material(result, amount=10, level=1, product=product, material=material, bp_me=10, is_advanced=False)
    expected = math.ceil((10 * 37 * ((100.0 - 10) / 100.0) * 0.99 * 0.958) / 10)
    assert qty == expected


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
