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
        r"if\s*\(typeof Corporation !== 'undefined' && \(!Corporation\.isMemoFrozen \|\| !Corporation\.isMemoFrozen\(\)\)\)\s*\{[\s\S]*?Corporation\.syncJobs\(\)[\s\S]*?Corporation\.syncBlueprints\(\)",
        blueprints_text,
    ), "Standalone recalculateProject() must refresh jobs and blueprint caches before evaluating BPO/BPC availability, unless memo is frozen for batch reuse."

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
        r"const\s+deliveredReadyFallback\s*=\s*blueprintLikeProduct[\s\S]*?:\s*getQuantityFromProductActionMap\(deliveredReadyByProduct,\s*product,\s*action\)",
        blueprints_text,
    ), (
        "Status fallback must still read delivered quantities by product plus activity, while blueprint-like rows use their own bucket-scoped fallback."
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
        r"availableBlueprintRunsByBucket\s*=\s*new Map\(\)[\s\S]*?Object\.keys\(hangarContext\.bucketHangars\)\.forEach\(bucketKey\s*=>\s*\{[\s\S]*?availableBlueprintRunsByBucket\.set\(Number\(bucketKey\),\s*new Map\(\)\)",
        blueprints_text,
    ), "Status recalc must also split BPC availability by project bucket so one ALPRO does not consume blueprint stock from another bucket."

    assert re.search(
        r"availableBlueprintRunsForJobs\s*=\s*new Map\(\)",
        blueprints_text,
    ), "Status recalc must keep a separate BPC-availability map for job inputs, distinct from bucket-scoped copy readiness."

    assert re.search(
        r"addQuantityRowsToMap\(availableBlueprintRunsForJobs,\s*\[\[bpc\.typeName,\s*availableRuns\]\]\)",
        blueprints_text,
    ), "Manufacturing and other job-input blueprint checks must use the whole project blueprint snapshot instead of a narrower sub-scope."

    assert re.search(
        r"const\s+blueprintMatchesHangar\s*=\s*function\(item,\s*hangar\)",
        blueprints_text,
    ), "Bucketed BPC readiness needs a hangar matcher that respects blueprint locationFlag metadata."

    assert re.search(
        r"if\s*\(blueprintLikeMaterial\)\s*\{[\s\S]*?getBlueprintAliasQuantity\(availableBlueprintRunsForJobs,\s*material\.type\)",
        blueprints_text,
    ), (
        "Blueprint-like material availability for manufacturing or invention inputs must read alias-aware BPC runs from the full project blueprint scope, or startable jobs can still show Čeká with a false hangar-missing note."
    )

    assert re.search(
        r"if\s*\(plannedJobs\[pos\]\[3\]\s*==\s*\"Copying\"\)\s*\{[\s\S]*?plannedJobs\[pos\]\[12\]\s*\+=\s*Math\.ceil\(material\.quantity\s*\*\s*todo\s*/\s*total\);",
        blueprints_text,
    ), "Copying producer rows used as subcomponents must propagate K vyrobe from full parent material volume, not only from raw parent todo count."

    assert re.search(
        r"const\s+remainingOutput\s*=\s*Math\.max\(required\s*-\s*effectiveReady\s*-\s*inprogress,\s*0\);[\s\S]*?const\s+requiredMaterialVolume\s*=\s*blueprintLikeMaterial[\s\S]*?Math\.ceil\(material\.quantity\s*\*\s*remainingOutput\s*/\s*totalOutput\)[\s\S]*?:\s*\(material\.quantity\s*/\s*runs\)",
        blueprints_text,
    ), "Blueprint-like subcomponents must be checked against the full remaining planned demand for the row, not only one-run startability."

    assert re.search(
        r"const\s+copyingUsesExternalOriginal\s*=\s*action\s*==\s*'Copying'\s*&&\s*isBlueprintLikeName\(material\.type\);[\s\S]*?if\s*\(copyingUsesExternalOriginal\)\s*\{[\s\S]*?return;",
        blueprints_text,
    ), (
        "Copying must not require the original blueprint as project-hangar material; that original is validated only through free BPO availability."
    )

    assert re.search(
        r"const\s+sourceHangars\s*=\s*getSourceHangarsForAction\(action,\s*useBufferHangars,\s*isAdvanced\);[\s\S]*?const\s+sourceHangar\s*=\s*sourceHangars\.sourceHangar;[\s\S]*?const\s+blueprintLikeProduct\s*=\s*isBlueprintLikeName\(product\);[\s\S]*?const\s+readyFromBlueprintStock\s*=\s*blueprintLikeProduct[\s\S]*?getBlueprintAliasQuantity\(availableBlueprintRunsByBucket\.get\(sourceHangar\),\s*product\)[\s\S]*?let\s+ready\s*=\s*Math\.max\(readyFromSheet,\s*readyFromBlueprintStock\)",
        blueprints_text,
    ), (
        "Blueprint-like product rows must read alias-aware BPC runs only from their own project bucket, or copies sitting under a suffix variant can stay invisible and leave the row on Čeká."
    )

    assert re.search(
        r"const\s+deliveredReadyFallback\s*=\s*blueprintLikeProduct[\s\S]*?getQuantityFromProductActionMap\(deliveredReadyByBucket\.get\(sourceHangar\),\s*product,\s*action\)[\s\S]*?:\s*getQuantityFromProductActionMap\(deliveredReadyByProduct,\s*product,\s*action\)",
        blueprints_text,
    ), (
        "Delivered-job fallback for blueprint-like products must stay bucket-scoped too, or recently delivered copies in another research bucket can wrongly satisfy this project's row."
    )

    assert re.search(
        r"addQuantityRowsToMap\([\s\S]*?availableBlueprintRunsForJobs,[\s\S]*?getFinishedJobProducts\(plannedJobs,\s*deliveredResearchJobs\)",
        blueprints_text,
    ), "Recently delivered BPC outputs must also feed the full job-input blueprint pool so manufacturing status does not wait for the next cache refresh."

    assert re.search(
        r"if\s*\(inprogress\s*>\s*0\s*&&\s*effectiveReady\s*\+\s*inprogress\s*>=\s*required\)\s*\{[\s\S]*?statusValues\[row\]\[0\]\s*=\s*'Běží';[\s\S]*?\}\s*else\s+if\s*\(effectiveReady\s*>=\s*required\)",
        blueprints_text,
    ), (
        "Rows should be marked Běží only when active in-progress quantity already covers the remaining requirement; otherwise they must still fall through to Hotovo or startability checks."
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
        r"const\s+allBlueprintsSnapshot\s*=\s*Corporation\.getBlueprintsCached\(\);[\s\S]*?bpos\s*=\s*\(allBlueprintsSnapshot\.data\s*\|\|\s*\[\]\)[\s\S]*?Number\(item\s*&&\s*item\.runs\)\s*===\s*-1[\s\S]*?adjustBlueprintAliasQuantity\(availableBposByBlueprint,\s*item\s*&&\s*item\.blueprint,\s*1\)",
        blueprints_text,
    ), "Copying status recalc must build a free-BPO counter from the live corporate blueprint cache, filtered to BPOs by runs == -1."

    assert re.search(
        r"allJobs\s*=\s*Corporation\.getJobsCached\(hangarContext\.hangars,\s*true\);[\s\S]*?allCorpJobs\s*=\s*Corporation\.getJobsCached\(null,\s*true\);[\s\S]*?allRunningJobs\s*=\s*allCorpJobs\.data\.filter\(item\s*=>\s*item\.status\s*==\s*'active'\)",
        blueprints_text,
    ), "BPO occupancy must be reduced by active jobs from the global corporate job snapshot, even when the running copy job belongs to another project."

    assert re.search(
        r"totalBposByBlueprint\s*=\s*new Map\(\)[\s\S]*?activeBpoReservationsByBlueprint\s*=\s*new Map\(\)[\s\S]*?preparedBpoReservationsByBlueprint\s*=\s*new Map\(\)",
        blueprints_text,
    ), "Copying diagnostics should keep separate alias-aware totals for total, active, and prepared BPO reservations."

    assert re.search(
        r"const\s+blueprintSnapshot\s*=\s*Corporation\.getBlueprintsCached\(hangarContext\.hangars\);[\s\S]*?const\s+allBlueprintsSnapshot\s*=\s*Corporation\.getBlueprintsCached\(\);",
        blueprints_text,
    ), "BPC copies should stay hangar-scoped, but original BPO availability must still come from the unrestricted corporation blueprint snapshot."

    assert re.search(
        r"const\s+adjustBlueprintAliasQuantity\s*=\s*function\(map,\s*blueprintName,\s*delta\)",
        blueprints_text,
    ), "Copying status recalc should maintain BPO counts through blueprint-name aliases, not only one exact sheet string."

    assert re.search(
        r"const\s+getPreparedCopyingReservationsMemo\s*=\s*function\(\)\s*\{[\s\S]*?bySheetId:\s*new Map\(\)[\s\S]*?total:\s*new Map\(\)",
        blueprints_text,
    ), "Prepared copy reservations should be disabled for both single and batch refreshes; only active jobs and current-sheet sequencing should reserve BPO capacity."

    assert re.search(
        r"const\s+updatePreparedCopyingReservationsMemo\s*=\s*function\(sheet,\s*rows,\s*statusValues\)\s*\{[\s\S]*?return;[\s\S]*?\};",
        blueprints_text,
    ), "Prepared reservation memo updates should be a no-op once cross-project prepared reservations are disabled."

    assert re.search(
        r"bpos\.forEach\(item\s*=>\s*\{[\s\S]*?adjustBlueprintAliasQuantity\(availableBposByBlueprint,\s*item\s*&&\s*item\.blueprint,\s*1\)",
        blueprints_text,
    ), "Free BPO count must be populated through alias-aware blueprint keys so manual BPO sheet names and project row names stay compatible."

    assert re.search(
        r"allRunningJobs\.forEach\(item\s*=>\s*\{[\s\S]*?activeBpoReservations\.add\(String\(item\.blueprintId\)\)",
        blueprints_text,
    ), "Free BPO count must be reduced by blueprints already occupied in running jobs."

    assert re.search(
        r"adjustBlueprintAliasQuantity\(availableBposByBlueprint,\s*item\s*&&\s*item\.blueprint,\s*-1\)",
        blueprints_text,
    ), "Running-job and prepared-row reservations must decrement the same alias-aware BPO counter they incremented."

    assert re.search(
        r"if\s*\(action\s*==\s*\"Copying\"\s*&&\s*canStart\)\s*\{[\s\S]*?getBlueprintAliasQuantity\(availableBposByBlueprint,\s*blueprint\)[\s\S]*?freeBpoCount\s*<=\s*0[\s\S]*?Není volné BPO!",
        blueprints_text,
    ), "Copying rows must flip to Čeká when no free BPO remains for the blueprint."

    assert re.search(
        r"const\s+bpoReason\s*=\s*'Není volné BPO! Celkem: '\s*\+\s*totalBpoCount\s*\+\s*', běží: '\s*\+\s*activeBpoCount\s*\+\s*', rezervováno: '\s*\+\s*preparedBpoCount",
        blueprints_text,
    ), "When Copying stays on Čeká, the note should explain whether the blocker is total BPO count, active usage, or prepared reservations."

    assert re.search(
        r"if\s*\(action\s*==\s*\"Copying\"\s*&&\s*canStart\)\s*\{[\s\S]*?const\s+freeBpoCount\s*=\s*blueprintKey\s*\?\s*getBlueprintAliasQuantity\(availableBposByBlueprint,\s*blueprint\)\s*:\s*0;[\s\S]*?if\s*\(freeBpoCount\s*<=\s*0\)\s*\{[\s\S]*?canStart\s*=\s*false;[\s\S]*?\}[\s\S]*?\}[\s\S]*?if\s*\(canStart\)\s*\{[\s\S]*?statusValues\[row\]\[0\]\s*=\s*'Připraveno';",
        blueprints_text,
    ), "Once Copying materials are startable, a positive free BPO count must allow the row to stay canStart and flip from Čeká to Připraveno."

    assert not re.search(
        r"getBlueprintAliasQuantity\(availableBlueprintRunsByBucket\.get\(sourceHangar\),\s*blueprint\)",
        blueprints_text,
    ), "Original BPO checks must not be constrained by the per-project BPC bucket; hangar scoping applies only to copies."

    assert re.search(
        r"let\s+missingMaterials\s*=\s*\[\];[\s\S]*?if\s*\(missingMaterials\.length\s*>\s*0\)\s*\{[\s\S]*?Hangár č\.",
        blueprints_text,
    ), "Hangar-missing note should only be built when some project-hangar material is actually missing."

    assert re.search(
        r"log\s*=\s*log\s*\?\s*\(log\s*\+\s*\"\\n- \"\s*\+\s*bpoReason\)\s*:\s*bpoReason",
        blueprints_text,
    ), "Pure BPO-availability blockers must report the explicit BPO diagnostic without a misleading generic hangar-only message."

    assert re.search(
        r"const\s+copyingUsesExternalOriginal\s*=\s*action\s*==\s*'Copying'\s*&&\s*blueprintLikeMaterial;[\s\S]*?if\s*\(copyingUsesExternalOriginal\)\s*\{[\s\S]*?return;",
        blueprints_text,
    ), "Copying status checks must skip project-hangar material validation for original blueprints."

    assert re.search(
        r"if\s*\(canStart\)\s*\{[\s\S]*?statusValues\[row\]\[0\]\s*=\s*'Připraveno';[\s\S]*?if\s*\(action\s*==\s*'Copying'\)\s*\{[\s\S]*?adjustBlueprintAliasQuantity\(availableBposByBlueprint,\s*blueprint,\s*-1\)",
        blueprints_text,
    ), "Earlier Copying rows marked Připraveno must reserve one free BPO so later rows for the same blueprint fall back to Čeká."

    assert re.search(
        r"const\s+collectPreparedCopyingReservations\s*=\s*function\(currentSheet\)",
        blueprints_text,
    ), "Project recalc should keep the prepared-reservations helper shape stable even after cross-project prepared reservations are disabled."

    assert re.search(
        r"const\s+buildPreparedCopyingReservationsForRows\s*=\s*function\(rows\)[\s\S]*?row\[3\]\s*!==\s*'Copying'\s*\|\|\s*row\[10\]\s*!==\s*'Připraveno'",
        blueprints_text,
    ), "Prepared-reservation helpers should still recognize only Copying rows marked Připraveno, even if that path is currently disabled."

    assert re.search(
        r"const\s+preparedCopyingReservations\s*=\s*collectPreparedCopyingReservations\(sheet\)",
        blueprints_text,
    ), "Copying recalc should still gather the prepared-reservations map before diagnostics, even though the map is expected to be empty now."

    assert re.search(
        r"let\s+preparedCopyingReservationsMemo\s*=\s*null;[\s\S]*?const\s+rebuildPreparedCopyingReservationsMemo\s*=\s*function\(\)",
        blueprints_text,
    ), "Prepared-reservation scaffolding can remain in place while the reservation path is disabled."

    assert re.search(
        r"const\s+getPreparedCopyingReservationsMemo\s*=\s*function\(\)\s*\{[\s\S]*?bySheetId:\s*new Map\(\)[\s\S]*?total:\s*new Map\(\)",
        blueprints_text,
    ), "Prepared reservation lookup should resolve to an empty map now that cross-project prepared reservations are disabled."

    assert re.search(
        r"updatePreparedCopyingReservationsMemo\(sheet,\s*refreshedPlannedJobs,\s*statusValues\)",
        blueprints_text,
    ), "The post-status update hook should remain callable even though prepared-reservation updates are now a no-op."

    assert re.search(
        r"resetPreparedCopyingReservationsMemo:\s*function\(\)\s*\{[\s\S]*?resetPreparedCopyingReservationsMemo\(\);",
        blueprints_text,
    ), "Blueprints API must expose a reset hook for the prepared Copying reservation memo."

    assert re.search(
        r"if\s*\(typeof\s+Blueprints\s*!==\s*'undefined'\s*&&\s*Blueprints\.resetPreparedCopyingReservationsMemo\)\s*\{[\s\S]*?Blueprints\.resetPreparedCopyingReservationsMemo\(\);",
        blueprints_text,
    ), "runUpdateAllProjects() must clear the prepared Copying reservation memo before a batch refresh starts."