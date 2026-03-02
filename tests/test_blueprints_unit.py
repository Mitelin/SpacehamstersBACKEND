import math

from py_backend.services.blueprints import add_material


def test_add_material_rounding_manufacturing_me() -> None:
    result = {"materials": []}
    product = {"quantity": 10}
    material = {"materialTypeID": 1, "material": "Tritanium", "quantity": 37, "activityId": 1}

    qty = add_material(result, amount=10, level=1, product=product, material=material, bp_me=10, is_advanced=False)
    expected = math.ceil((10 * 37 * ((100.0 - 10) / 100.0) * 0.99 * 0.958) / 10)
    assert qty == expected
