from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BLUEPRINTS_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Blueprints.gs"
CORPORATION_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Corporation.gs"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def test_recently_delivered_jobs_are_projected_into_stock_not_running() -> None:
    blueprints_text = _read_text(BLUEPRINTS_GS)
    corporation_text = _read_text(CORPORATION_GS)

    assert re.search(
        r"data:\s*alljobs\.data\.filter\(job\s*=>\s*job\.status\s*==\s*'active'\)",
        blueprints_text,
    ), "Project refresh must keep the in-progress job view limited to active jobs even when it loads the all-jobs snapshot."

    assert re.search(
        r"Corporation\.getJobsCached\(hangars,\s*true\)",
        blueprints_text,
    ), "Project refresh must also load the all-jobs view to reconcile recently delivered jobs."

    assert re.search(
        r"let\s+deliveredJobs\s*=\s*alljobs\.data\.filter\(job\s*=>\s*job\.status\s*==\s*'delivered'\s*&&\s*job\.completedTime\s*>\s*items\.lastModified\)",
        blueprints_text,
    ), (
        "Delivered jobs completed after the asset snapshot must be detected so their output stays counted "
        "until stock refresh catches up."
    )

    assert re.search(
        r"getFinishedJobProducts\s*\(\s*plannedJobs\s*,\s*deliveredJobs",
        blueprints_text,
    ), "Recently delivered jobs must be converted into projected stock via getFinishedJobProducts()."

    assert re.search(
        r"getFinishedJobProducts\s*\(\s*plannedJobs\s*,\s*deliveredJobs[\s\S]*?SpreadsheetApp\.flush\(\);[\s\S]*?this\.recalculateProject\(sheet,\s*notify\)",
        blueprints_text,
    ), (
        "Delivered-job fallback must be written into project tables before recalculateProject() runs, "
        "so the same refresh sees output that is not yet present in the assets cache."
    )

    assert re.search(
        r"const\s+assetSnapshot\s*=\s*Corporation\.getAssetsCached\(hangarContext\.hangars\)",
        blueprints_text,
    ), "recalculateProject() must compare delivered jobs against the same project asset scope instead of waiting for another refresh."

    assert re.search(
        r"recalc read blueprint params[\s\S]*?const\s+hangarContext\s*=\s*buildProjectHangarContext\(",
        blueprints_text,
    ), "recalculateProject() must build hangarContext before using delivered-job fallback against the project scope."

    assert re.search(
        r"Corporation\.syncJobs\(\)[\s\S]*?Corporation\.getJobsCached\(hangars,\s*true\)",
        blueprints_text,
    ), "Explicit project refresh must force-refresh jobs cache before reading all jobs, or newly delivered jobs can stay invisible until cache expiry."

    assert re.search(
        r"Corporation\.syncBlueprints\(\)[\s\S]*?Corporation\.getBlueprintsCached\(hangarsBPC\)",
        blueprints_text,
    ), (
        "Explicit project refresh must force-refresh blueprint cache before reading project BPC stock, "
        "or physically present blueprints can stay invisible until cache expiry and rows flip to Čeká."
    )

    assert re.search(
        r"warm cache: jobs'[\s\S]*?Corporation\.syncJobs\(\)",
        blueprints_text,
    ), "runUpdateAllProjects() must warm the jobs snapshot via syncJobs() before freezing memo reuse for the ALPRO batch."

    assert re.search(
        r"warm cache: blueprints'[\s\S]*?Corporation\.syncBlueprints\(\)",
        blueprints_text,
    ), "runUpdateAllProjects() must warm the blueprint snapshot via syncBlueprints() so project BPC stock is not stale across the batch."

    assert re.search(
        r"item\.status\s*==\s*'delivered'\s*&&\s*item\.completedTime\s*>\s*assetSnapshot\.lastModified",
        blueprints_text,
    ), "recalculateProject() must detect jobs delivered after the project asset snapshot."

    assert re.search(
        r"addQuantityRowsToProductActionMap\s*\([\s\S]*?getFinishedJobProducts\(plannedJobs,\s*deliveredJobs,\s*null,\s*true\)",
        blueprints_text,
    ), (
        "Delivered-job fallback must keep activity in its lookup key, or T2 invention output can be mistaken "
        "for manufactured stock of the same product name."
    )

    assert re.search(
        r"const\s+deliveredReadyFallback\s*=\s*getQuantityFromProductActionMap\(deliveredReadyByProduct,\s*product,\s*action\)",
        blueprints_text,
    ), (
        "Status fallback must read delivered quantities by product plus activity so T2 invention rows do not satisfy "
        "manufacturing output rows."
    )

    assert re.search(
        r"const\s+resolvePreferredProductRow\s*=\s*function\(rowsByProductKey,\s*rows,\s*productName\)",
        blueprints_text,
    ), "Project recalc must resolve duplicate product rows through a dedicated producer-row helper."

    assert re.search(
        r"isBlueprintLikeName\(productName\)\s*\?\s*\['Copying'\]\s*:\s*\['Manufacturing',\s*'Reaction'\]",
        blueprints_text,
    ), (
        "Duplicate product names must prefer Copying for blueprint-like materials and real item-producing actions "
        "for regular materials, or one running T2 job can wrongly flip the next run to Čeká."
    )

    assert re.search(
        r"let\s+jobRecordIndex\s*=\s*resolvePreferredProductRow\(plannedRowsByProductKey,\s*refreshedPlannedJobs,\s*material\.type\)",
        blueprints_text,
    ), (
        "Material availability checks must resolve duplicate producer rows via preferred actions instead of the first "
        "product-name match."
    )

    assert re.search(
        r"availableBlueprintRunsByName\s*=\s*new Map\(\)",
        blueprints_text,
    ), "Status recalc must build a raw available-BPC-runs map from the corporate blueprint snapshot."

    assert re.search(
        r"if\s*\(blueprintLikeMaterial\)\s*\{[\s\S]*?getQuantityFromMap\(availableBlueprintRunsByName,\s*material\.type\)",
        blueprints_text,
    ), (
        "Blueprint-like material availability must read real BPC runs from the blueprint snapshot, not net deficit "
        "formula columns, or rows can stay on Čeká even when another job can be started."
    )

    assert re.search(
        r"missingVolume\s*-=?\s*projectedDelivered|projectedDelivered\s*>\s*0\)\s*missingVolume\s*-?=\s*projectedDelivered",
        blueprints_text,
    ), "When stock tables still lag, recalculateProject() must reduce missing-material gaps by recently delivered job output."

    assert re.search(
        r"if\s*\(!all\)\s*\{[\s\S]*?item\s*=>\s*item\.status\s*==\s*'active'",
        corporation_text,
    ), "Default getJobsCached() contract must stay limited to active jobs so delivered work is not double-counted as running."

    assert re.search(
        r"var\s+_blueprintMatchesHangar\s*=\s*function\(item,\s*hangar\)",
        corporation_text,
    ), "Blueprint filtering must use a dedicated hangar matcher because corp blueprint location metadata differs from assets."

    assert re.search(
        r"hangar\.locationType\s*==\s*'station'[\s\S]*?item\.locationFlag\s*==\s*hangar\.locationFlag",
        corporation_text,
    ), (
        "Blueprint hangar matching must consider division locationFlag, or project BPC stock can stay invisible "
        "even when copies are physically present in the selected corp hangar."
    )

    assert re.search(
        r"getBlueprintsCached\(hangars\)[\s\S]*?_blueprintMatchesHangar\(item,\s*hangar\)",
        corporation_text,
    ), "Cached project blueprint scope must use the locationFlag-aware hangar matcher."

    assert re.search(
        r"isMemoFrozen:\s*function\(\)\s*\{[\s\S]*?return\s+_freezeMemo;",
        corporation_text,
    ), "Blueprint refresh logic needs a public way to detect frozen memo mode so single-project refresh can force job sync without breaking ALPRO batch reuse."

    assert re.search(
        r"startDate:\s*a\.start_date,[\s\S]*?endDate:\s*a\.end_date,[\s\S]*?completedDate:\s*a\.completed_date,[\s\S]*?startTime:\s*new Date\(a\.start_date\)\.getTime\(\),[\s\S]*?endTime:\s*new Date\(a\.end_date\)\.getTime\(\),[\s\S]*?completedTime:\s*new Date\(a\.completed_date\)\.getTime\(\)",
        corporation_text,
    ), "Freshly synced jobs must preserve parsed start/end/completed timestamps in memo, or delivered-job reconciliation breaks until the sheet is reloaded."


def test_copying_status_reserves_free_bpo_capacity() -> None:
    blueprints_text = _read_text(BLUEPRINTS_GS)

    assert re.search(
        r"availableBposByBlueprint\s*=\s*new Map\(\)[\s\S]*?bpos\.forEach\(item\s*=>\s*\{[\s\S]*?availableBposByBlueprint\.set\(",
        blueprints_text,
    ), "Copying status recalc must build a free-BPO counter from Corporation.loadBPOs() by blueprint name."

    assert re.search(
        r"allRunningJobs\.forEach\(item\s*=>\s*\{[\s\S]*?activeBpoReservations\.add\(String\(item\.blueprintId\)\)",
        blueprints_text,
    ), "Free BPO count must be reduced by blueprints already occupied in running jobs."

    assert re.search(
        r"if\s*\(action\s*==\s*\"Copying\"\s*&&\s*canStart\)\s*\{[\s\S]*?availableBposByBlueprint\.get\(blueprintKey\)[\s\S]*?freeBpoCount\s*<=\s*0[\s\S]*?Není volné BPO!",
        blueprints_text,
    ), "Copying rows must flip to Čeká when no free BPO remains for the blueprint."

    assert re.search(
        r"if\s*\(canStart\)\s*\{[\s\S]*?statusValues\[row\]\[0\]\s*=\s*'Připraveno';[\s\S]*?if\s*\(action\s*==\s*'Copying'\)\s*\{[\s\S]*?availableBposByBlueprint\.set\(",
        blueprints_text,
    ), "Earlier Copying rows marked Připraveno must reserve one free BPO so later rows for the same blueprint fall back to Čeká."

    assert re.search(
        r"const\s+collectPreparedCopyingReservations\s*=\s*function\(currentSheet\)",
        blueprints_text,
    ), "Project recalc must expose a helper that inspects prepared Copying reservations in other project sheets."

    assert re.search(
        r"const\s+buildPreparedCopyingReservationsForRows\s*=\s*function\(rows\)[\s\S]*?row\[3\]\s*!==\s*'Copying'\s*\|\|\s*row\[10\]\s*!==\s*'Připraveno'",
        blueprints_text,
    ), "Cross-project BPO reservation must only consume capacity from rows that already mark the Copying job as Připraveno."

    assert re.search(
        r"const\s+preparedCopyingReservations\s*=\s*collectPreparedCopyingReservations\(sheet\)[\s\S]*?preparedCopyingReservations\.forEach\(\(reservedCount,\s*blueprintKey\)\s*=>\s*\{[\s\S]*?availableBposByBlueprint\.set\(",
        blueprints_text,
    ), "Before computing current-sheet Copying readiness, recalc must subtract prepared reservations found in other project sheets."

    assert re.search(
        r"let\s+preparedCopyingReservationsMemo\s*=\s*null;[\s\S]*?const\s+rebuildPreparedCopyingReservationsMemo\s*=\s*function\(\)",
        blueprints_text,
    ), "Cross-project Copying reservation scan should be memoized for the current Apps Script execution."

    assert re.search(
        r"preparedCopyingReservationsMemo\s*\|\|\s*rebuildPreparedCopyingReservationsMemo\(\)",
        blueprints_text,
    ), "Reservation lookup should reuse the prepared Copying memo instead of rescanning all project sheets every recalc."

    assert re.search(
        r"updatePreparedCopyingReservationsMemo\(sheet,\s*refreshedPlannedJobs,\s*statusValues\)",
        blueprints_text,
    ), "After writing statuses, recalc must refresh the memoized Copying reservations for the current sheet."

    assert re.search(
        r"resetPreparedCopyingReservationsMemo:\s*function\(\)\s*\{[\s\S]*?resetPreparedCopyingReservationsMemo\(\);",
        blueprints_text,
    ), "Blueprints API must expose a reset hook for the prepared Copying reservation memo."

    assert re.search(
        r"if\s*\(typeof\s+Blueprints\s*!==\s*'undefined'\s*&&\s*Blueprints\.resetPreparedCopyingReservationsMemo\)\s*\{[\s\S]*?Blueprints\.resetPreparedCopyingReservationsMemo\(\);",
        blueprints_text,
    ), "runUpdateAllProjects() must clear the prepared Copying reservation memo before a batch refresh starts."