from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Alliance Auth main/alt identities")
    parser.add_argument("--project", required=True)
    parser.add_argument("--settings", default="myauth.settings.local")
    parser.add_argument("--corporation-id", required=True, type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    project = Path(args.project).resolve()
    os.chdir(project)
    sys.path.insert(0, str(project))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", args.settings)

    import django

    django.setup()

    from allianceauth.authentication.models import CharacterOwnership, UserProfile

    corp_ownerships = CharacterOwnership.objects.filter(
        character__corporation_id=args.corporation_id
    )
    user_ids = list(corp_ownerships.values_list("user_id", flat=True).distinct())
    profiles = {
        profile.user_id: profile
        for profile in UserProfile.objects.filter(user_id__in=user_ids).select_related("main_character")
    }
    ownerships = CharacterOwnership.objects.filter(user_id__in=user_ids).select_related("character")

    identities = []
    for ownership in ownerships:
        profile = profiles.get(ownership.user_id)
        main_character = profile.main_character if profile else None
        if main_character is None:
            continue
        character = ownership.character
        identities.append(
            {
                "authUserId": ownership.user_id,
                "mainCharacterId": main_character.character_id,
                "mainCharacterName": main_character.character_name,
                "characterId": character.character_id,
                "characterName": character.character_name,
                "corporationId": character.corporation_id,
                "isCurrentCorpMember": character.corporation_id == args.corporation_id,
            }
        )

    payload = {
        "corporationId": args.corporation_id,
        "syncedAt": datetime.now(timezone.utc).isoformat(),
        "identities": identities,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
    temporary.replace(output)


if __name__ == "__main__":
    main()