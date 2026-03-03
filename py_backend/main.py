from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route

from . import db
from .esi import ESIClient
from .logger import log
from .services import blueprints as blueprints_service
from .services.assets import AssetsService
from .services.jobs import JobsService
from .services.user_info import UserInfoService
from .services.wallet_journal import WalletJournalService
from .services.wallet_transactions import WalletTransactionsService
from .settings import get_settings


def create_app() -> Starlette:
    settings = get_settings()
    esi = ESIClient(settings.eve_api_base)
    user_info = UserInfoService(esi)
    assets_service = AssetsService(esi)
    jobs_service = JobsService(esi)
    wallet_journal_service = WalletJournalService(esi)
    wallet_transactions_service = WalletTransactionsService(esi)

    @asynccontextmanager
    async def lifespan(app: Starlette):
        app.state.esi = esi
        app.state.user_info = user_info
        app.state.assets_service = assets_service
        app.state.jobs_service = jobs_service
        app.state.wallet_journal_service = wallet_journal_service
        app.state.wallet_transactions_service = wallet_transactions_service
        app.state.scheduler = None

        await db.init_pool()

        if int(settings.enable_scheduler) == 1:
            scheduler = AsyncIOScheduler(timezone="UTC")

            async def _jobs_sync() -> None:
                try:
                    log(2, "cron() jobs.sync")
                    access_token = await user_info.get_ceo_access_token()
                    cnt = await jobs_service.sync(settings.corporation_id, access_token)
                    log(1, f"Records synchronized: {cnt}")
                except Exception as exc:
                    log(3, f"cron() jobs.sync Error: {exc}")

            async def _wallet_sync() -> None:
                try:
                    log(2, "cron() wallet.sync")
                    access_token = await user_info.get_ceo_access_token()
                    cnt = await wallet_journal_service.sync(settings.corporation_id, 1, access_token)
                    log(1, f"Records synchronized: {cnt}")
                except Exception as exc:
                    log(3, f"cron() wallet.sync Error: {exc}")

            def _run(coro):
                asyncio.create_task(coro())

            scheduler.add_job(lambda: _run(_jobs_sync), CronTrigger(hour=4, minute=0))
            scheduler.add_job(lambda: _run(_wallet_sync), CronTrigger(hour=4, minute=15))
            scheduler.start()
            app.state.scheduler = scheduler

        try:
            yield
        finally:
            if app.state.scheduler:
                app.state.scheduler.shutdown(wait=False)
            await esi.close()
            await db.close_pool()

    async def post_user_info(request: Request) -> Response:
        log(2, "POST /api/userInfo")
        body = await request.json()
        log(1, body)
        await request.app.state.user_info.store(body)
        return PlainTextResponse("ok")

    async def post_blueprints_calculate(request: Request) -> Response:
        log(2, "POST /api/blueprints/calculate")
        body = await request.json()
        log(1, body)

        efficiency = {
            "shipT1ME": body.get("shipT1ME") or body.get("typeme") or 0,
            "shipT1TE": body.get("shipT1TE") or body.get("typete") or 0,
            "shipT2ME": body.get("shipT2ME") or body.get("typeme") or 0,
            "shipT2TE": body.get("shipT2TE") or body.get("typete") or 0,
            "moduleT1ME": body.get("moduleT1ME") or body.get("moduleme") or 0,
            "moduleT1TE": body.get("moduleT1TE") or body.get("modulete") or 0,
            "moduleT2ME": body.get("moduleT2ME") or body.get("moduleme") or 0,
            "moduleT2TE": body.get("moduleT2TE") or body.get("modulete") or 0,
        }

        build_t1 = body.get("buildT1")
        if build_t1 is None:
            build_t1 = True
        copy_bpo = body.get("copyBPO")
        if copy_bpo is None:
            copy_bpo = True
        produce_fuel_blocks = body.get("produceFuelBlocks")
        if produce_fuel_blocks is None:
            produce_fuel_blocks = True

        merge_modules = body.get("mergeModules")
        if merge_modules is None:
            merge_modules = False

        # Optional facility/rig configuration (used for material multipliers).
        # If omitted, service defaults preserve legacy behavior.
        m_role, m_rig, r_rig = blueprints_service.resolve_material_multipliers(
            body.get("industryStructureType"),
            body.get("industryRig"),
            body.get("reactionRig"),
            manufacturing_role_bonus=body.get("manufacturingRoleBonus"),
            manufacturing_rig_bonus=body.get("manufacturingRigBonus"),
            reaction_rig_bonus=body.get("reactionRigBonus"),
        )

        try:
            details = await blueprints_service.get_blueprints_details(
                body.get("types") or [],
                efficiency,
                bool(build_t1),
                bool(copy_bpo),
                bool(produce_fuel_blocks),
                bool(merge_modules),
                manufacturing_role_bonus=m_role,
                manufacturing_rig_bonus=m_rig,
                reaction_rig_bonus=r_rig,
            )
            return JSONResponse(details)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, "POST /api/blueprints/calculate finished")

    async def post_blueprints_id_calculate(request: Request) -> Response:
        type_id = int(request.path_params["type_id"])
        log(2, f"POST /api/blueprints/{type_id}/calculate")
        body = await request.json()
        log(1, body)

        efficiency = {
            "shipT1ME": body.get("shipT1ME") or body.get("typeme") or 0,
            "shipT1TE": body.get("shipT1TE") or body.get("typete") or 0,
            "shipT2ME": body.get("shipT2ME") or body.get("typeme") or 0,
            "shipT2TE": body.get("shipT2TE") or body.get("typete") or 0,
            "moduleT1ME": body.get("moduleT1ME") or body.get("moduleme") or 0,
            "moduleT1TE": body.get("moduleT1TE") or body.get("modulete") or 0,
            "moduleT2ME": body.get("moduleT2ME") or body.get("moduleme") or 0,
            "moduleT2TE": body.get("moduleT2TE") or body.get("modulete") or 0,
        }

        build_t1 = body.get("buildT1")
        if build_t1 is None:
            build_t1 = True
        copy_bpo = body.get("copyBPO")
        if copy_bpo is None:
            copy_bpo = True
        produce_fuel_blocks = body.get("produceFuelBlocks")
        if produce_fuel_blocks is None:
            produce_fuel_blocks = True

        merge_modules = body.get("mergeModules")
        if merge_modules is None:
            merge_modules = False

        m_role, m_rig, r_rig = blueprints_service.resolve_material_multipliers(
            body.get("industryStructureType"),
            body.get("industryRig"),
            body.get("reactionRig"),
            manufacturing_role_bonus=body.get("manufacturingRoleBonus"),
            manufacturing_rig_bonus=body.get("manufacturingRigBonus"),
            reaction_rig_bonus=body.get("reactionRigBonus"),
        )

        amount = body.get("amount")
        if amount is None:
            return PlainTextResponse("Chyba: amount missing")

        try:
            details = await blueprints_service.get_blueprint_details(
                type_id,
                int(amount),
                efficiency,
                bool(build_t1),
                bool(copy_bpo),
                bool(produce_fuel_blocks),
                bool(merge_modules),
                manufacturing_role_bonus=m_role,
                manufacturing_rig_bonus=m_rig,
                reaction_rig_bonus=r_rig,
            )
            return JSONResponse(details)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"POST /api/blueprints/{type_id}/calculate finished")

    async def post_ore_material(request: Request) -> Response:
        log(2, "POST /api/ore/material")
        body = await request.json()
        log(1, body)
        try:
            material = await blueprints_service.get_ore_details(body.get("typeName"))
            return JSONResponse(material)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(2, "POST /api/ore/material finished")

    async def get_assets_sync(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"GET /api/corporation/{corporation_id}/assets/sync")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            ceo_access_token = await request.app.state.user_info.get_ceo_access_token()
            cnt = await request.app.state.assets_service.sync(corporation_id, ceo_access_token)
            msg = f"Records synchronized: {cnt}"
            log(1, msg)
            return PlainTextResponse(msg)
        except Exception as exc:
            log(3, f"GET /api/corporation/{corporation_id}/assets/sync Error:{exc}")
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(2, f"GET /api/corporation/{corporation_id}/assets/sync finished")

    async def get_assets_locations(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        station_id = int(request.path_params["station_id"])
        log(2, f"GET /api/corporation/{corporation_id}/assets/locations/{station_id}")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            locations = await request.app.state.assets_service.get_locations(station_id)
            return JSONResponse(locations)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/assets/locations/{station_id} finished")

    async def post_assets(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"POST /api/corporation/{corporation_id}/assets")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            body = await request.json()
            items = await request.app.state.assets_service.get_items(
                int(body.get("locationID")),
                str(body.get("locationType")),
                str(body.get("locationFlag")),
            )
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"POST /api/corporation/{corporation_id}/assets finished")

    async def post_assets_direct(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"POST /api/corporation/{corporation_id}/assetsDirect")
        try:
            body = await request.json()
            log(1, body)
            params = [
                {
                    "locationID": item.get("locationID"),
                    "locationType": item.get("locationType"),
                    "locationFlag": item.get("locationFlag"),
                }
                for item in list(body)
            ]

            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            ceo_access_token = await request.app.state.user_info.get_ceo_access_token()
            items = await request.app.state.assets_service.get_items_direct(corporation_id, ceo_access_token, params)
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"POST /api/corporation/{corporation_id}/assetsDirect finished")

    async def get_assets_all(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"GET /api/corporation/{corporation_id}/assets")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            items = await request.app.state.assets_service.get_all_items()
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/assets finished")

    async def get_jobs_sync(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"GET /api/corporation/{corporation_id}/jobs/sync")
        try:
            access_token = await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            cnt = await request.app.state.jobs_service.sync(corporation_id, access_token)
            msg = f"Records synchronized: {cnt}"
            log(1, msg)
            return PlainTextResponse(msg)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/jobs/sync finished")

    async def get_jobs_location(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        location_id = int(request.path_params["location_id"])
        log(2, f"GET /api/corporation/{corporation_id}/jobs/location/{location_id}")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            items = await request.app.state.jobs_service.get_jobs(location_id)
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/jobs/location/{location_id} finished")

    async def get_jobs_report(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        year = int(request.path_params["year"])
        month = int(request.path_params["month"])
        log(2, f"GET /api/corporation/{corporation_id}/jobs/report/{year}{month}")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            items = await request.app.state.jobs_service.get_jobs_report(year, month)
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/jobs/report/{year}{month} finished")

    async def post_jobs_velocity(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"GET /api/corporation/{corporation_id}/jobs/velocity")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            body = await request.json()
            categories = body.get("categories")
            log(1, f"- categories: {categories}")
            items = await request.app.state.jobs_service.get_jobs_velocity(categories)
            log(1, f"Items found: {len(items)}")
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/jobs/velocity finished")

    async def get_jobs_direct(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"GET /api/corporation/{corporation_id}/jobs/direct")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            ceo_access_token = await request.app.state.user_info.get_ceo_access_token()
            items = await request.app.state.jobs_service.get_all_jobs_direct(corporation_id, ceo_access_token)
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/jobs/direct finished")

    async def get_jobs_all(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        log(2, f"GET /api/corporation/{corporation_id}/jobs")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            items = await request.app.state.jobs_service.get_all_jobs()
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/jobs finished")

    async def post_wallet_journal_report(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        wallet = int(request.path_params["wallet"])
        log(2, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/journal/report")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            body = await request.json()
            log(1, body)
            year = body.get("year")
            if not year:
                return PlainTextResponse("year parameter missing")
            month = body.get("month")
            if not month:
                return PlainTextResponse("month parameter missing")
            types = body.get("types")
            if types is None:
                return PlainTextResponse("types parameter missing")
            items = await request.app.state.wallet_journal_service.get_report(wallet, int(year), int(month), types)
            log(1, f"Items found: {len(items)}")
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/journal/report finished")

    async def get_wallet_journal_sync(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        wallet = int(request.path_params["wallet"])
        log(2, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/journal/sync")
        try:
            access_token = await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            cnt = await request.app.state.wallet_journal_service.sync(corporation_id, wallet, access_token)
            msg = f"Records synchronized: {cnt}"
            log(1, msg)
            return PlainTextResponse(msg)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/journal/sync finished")

    async def get_wallet_transactions_sync(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        wallet = int(request.path_params["wallet"])
        log(2, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/transactions/sync")
        try:
            access_token = await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            cnt = await request.app.state.wallet_transactions_service.sync(corporation_id, wallet, access_token)
            msg = f"Records synchronized: {cnt}"
            log(1, msg)
            return PlainTextResponse(msg)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/transactions/sync finished")

    async def get_wallet_pl(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        wallet = int(request.path_params["wallet"])
        year = int(request.path_params["year"])
        month = int(request.path_params["month"])
        log(2, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/pl/...")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            items = await request.app.state.wallet_journal_service.get_pl(year, month)
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/pl finished")

    async def get_wallet_volumes(request: Request) -> Response:
        corporation_id = int(request.path_params["corporation_id"])
        wallet = int(request.path_params["wallet"])
        log(2, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/volumes")
        try:
            await request.app.state.user_info.validate_token(request.headers.get("authorization"))
            items = await request.app.state.wallet_transactions_service.get_type_volumes()
            return JSONResponse(items)
        except Exception as exc:
            return PlainTextResponse(f"Chyba: {exc}")
        finally:
            log(1, f"GET /api/corporation/{corporation_id}/wallet/{wallet}/volumes finished")

    routes = [
        Route("/api/userInfo", post_user_info, methods=["POST"]),
        Route("/api/blueprints/calculate", post_blueprints_calculate, methods=["POST"]),
        Route("/api/blueprints/{type_id:int}/calculate", post_blueprints_id_calculate, methods=["POST"]),
        Route("/api/ore/material", post_ore_material, methods=["POST"]),
        Route("/api/corporation/{corporation_id:int}/assets/sync", get_assets_sync, methods=["GET"]),
        Route(
            "/api/corporation/{corporation_id:int}/assets/locations/{station_id:int}",
            get_assets_locations,
            methods=["GET"],
        ),
        Route("/api/corporation/{corporation_id:int}/assets", post_assets, methods=["POST"]),
        Route("/api/corporation/{corporation_id:int}/assetsDirect", post_assets_direct, methods=["POST"]),
        Route("/api/corporation/{corporation_id:int}/assets", get_assets_all, methods=["GET"]),
        Route("/api/corporation/{corporation_id:int}/jobs/sync", get_jobs_sync, methods=["GET"]),
        Route(
            "/api/corporation/{corporation_id:int}/jobs/location/{location_id:int}",
            get_jobs_location,
            methods=["GET"],
        ),
        Route(
            "/api/corporation/{corporation_id:int}/jobs/report/{year:int}/{month:int}",
            get_jobs_report,
            methods=["GET"],
        ),
        Route("/api/corporation/{corporation_id:int}/jobs/velocity", post_jobs_velocity, methods=["POST"]),
        Route("/api/corporation/{corporation_id:int}/jobs/direct", get_jobs_direct, methods=["GET"]),
        Route("/api/corporation/{corporation_id:int}/jobs", get_jobs_all, methods=["GET"]),
        Route(
            "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/journal/report",
            post_wallet_journal_report,
            methods=["POST"],
        ),
        Route(
            "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/journal/sync",
            get_wallet_journal_sync,
            methods=["GET"],
        ),
        Route(
            "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/transactions/sync",
            get_wallet_transactions_sync,
            methods=["GET"],
        ),
        Route(
            "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/pl/{year:int}/{month:int}",
            get_wallet_pl,
            methods=["GET"],
        ),
        Route(
            "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/volumes",
            get_wallet_volumes,
            methods=["GET"],
        ),
    ]
    return Starlette(debug=False, routes=routes, lifespan=lifespan)


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("py_backend.main:app", host="0.0.0.0", port=8010, reload=False)
