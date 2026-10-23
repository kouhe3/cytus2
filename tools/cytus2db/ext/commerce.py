"""Commerce entities: CAPSO shop, CAPSO! gacha and IAP shop bundles.

Each family keeps its own entity type and field set: a CAPSO pack item is
either a chart bundle, an illustration unlock or a tap-effect unlock; a gacha
reward expands its chart id into canonical chart keys; a shop bundle embeds
its items and tiers. Black Market is the ``black_market`` state of a bundle,
never a separate entity.

Tables (TextAsset JSON first, bundle fallback):

``text/capsoshopdata``                  capsoshopdata.ab:capsoshoppacks
``text/gacharewarddata/gachamachines``  gacharewarddata.ab:gachamachines
``text/gacharewarddata/gachareward``    gacharewarddata.ab:gachareward
``text/bundle_sale_data``               sharedassets0.assets:bundle_sale_data
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from ..errors import BuildError, InputError
from ..keys import chart_key, entity_key, song_key
from ..sources import InputSource, Table

# Reward/item ids suffix difficulty indices; the mapping is verified by every
# expanded chart key resolving in song_pack_data.
_DIFFICULTIES = ("Easy", "Hard", "Chaos", "Glitch")
_CHART_ITEM_RE = re.compile(r"^(?P<song>.+)_(?P<indices>\d+(?:,\d+)*)$")


def _text_asset(locator: str, note: str | None = None) -> dict[str, str]:
    entry = {"kind": "text_asset", "locator": locator}
    if note is not None:
        entry["note"] = note
    return entry


def _required(raw: dict[str, Any], key: str, where: str) -> Any:
    value = raw.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise BuildError(f"{where}: missing {key}")
    return value


def _integer(raw: dict[str, Any], key: str, where: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise BuildError(f"{where}: {key} must be an integer")
    return value


def _boolean(raw: dict[str, Any], key: str, where: str) -> bool:
    value = raw.get(key)
    if not isinstance(value, bool):
        raise BuildError(f"{where}: {key} must be a boolean")
    return value


def _object(raw: dict[str, Any], key: str, where: str) -> dict[str, Any]:
    value = raw.get(key)
    if not isinstance(value, dict):
        raise BuildError(f"{where}: {key} must be an object")
    return value


def _array(raw: dict[str, Any], key: str, where: str) -> list[Any]:
    value = raw.get(key)
    if not isinstance(value, list):
        raise BuildError(f"{where}: {key} must be an array")
    return value


def _rows(table: Table, what: str) -> list[dict[str, Any]]:
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    rows: list[dict[str, Any]] = []
    for index, raw in enumerate(table.data):
        if not isinstance(raw, dict):
            raise BuildError(f"{table.locator}[{index}]: must be an object ({what})")
        rows.append(raw)
    return rows


def _split_chart_id(identifier: str, where: str) -> tuple[str, list[str]]:
    match = _CHART_ITEM_RE.match(identifier)
    if match is None:
        raise BuildError(f"{where}: {identifier!r} is not <songId>_<difficulty indices>")
    difficulties = []
    for token in match.group("indices").split(","):
        index = int(token)
        if index >= len(_DIFFICULTIES):
            raise BuildError(f"{where}: unknown difficulty index {index} in {identifier!r}")
        difficulties.append(_DIFFICULTIES[index])
    return match.group("song"), difficulties


# ------------------------------------------------------------- CAPSO shop
def build_capso_shop(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    table = source.json_or_bundle(
        (("capsoshopdata",), ("capsoshopdata", "capsoshoppacks")),
        "capsoshopdata.ab",
        "capsoshoppacks",
    )
    packs: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    for pack_index, raw_pack in enumerate(_rows(table, "capsoshop pack")):
        locator = f"{table.locator}[{pack_index}]"
        pack_id = str(_required(raw_pack, "Id", locator))
        pack_key = entity_key("capso_shop_pack", pack_id)
        packs.append(
            {
                "id": pack_key,
                "type": "capso_shop_pack",
                "game_id": pack_id,
                "name": str(raw_pack.get("Name") or ""),
                "create_order": _integer(raw_pack, "CreateOrder", locator),
                "icon_path": str(raw_pack.get("IconPath") or ""),
                "default_price_string": str(raw_pack.get("DefaultPriceString") or ""),
                "capso_price": _integer(raw_pack, "CapsoPrice", locator),
                "available_for_capso": _boolean(
                    raw_pack, "IsAvailableForCapso", locator
                ),
                "available_for_iap": _boolean(raw_pack, "IsAvailableForIAP", locator),
                "provenance": [_text_asset(locator)],
            }
        )
        for position, raw_item in enumerate(_array(raw_pack, "Items", locator)):
            item_locator = f"{locator}.Items[{position}]"
            item_id = str(_required(raw_item, "Id", item_locator))
            item_type = _integer(raw_item, "ItemType", item_locator)
            record: dict[str, Any] = {
                "id": f"capso_shop_item/{pack_id}/{quote(item_id, safe=',._-')}",
                "type": "capso_shop_item",
                "game_id": f"{pack_id}/{item_id}",
                "pack_id": pack_key,
                "item_id": item_id,
                "item_type": item_type,
                "position": position,
                "provenance": [_text_asset(item_locator)],
            }
            if item_type == 0:
                song, difficulties = _split_chart_id(item_id, item_locator)
                record["kind"] = "chart"
                record["song_id"] = song_key(song)
                record["chart_ids"] = [
                    chart_key(song, difficulty) for difficulty in difficulties
                ]
            elif item_type == 1:
                record["kind"] = "illustration"
                record["illustration_id"] = entity_key("illustration", item_id)
            elif item_type == 2:
                record["kind"] = "tap_fx"
                record["tap_fx_id"] = item_id
            else:
                raise BuildError(f"{item_locator}: unknown ItemType {item_type}")
            items.append(record)
    return {"capso_shop_pack": packs, "capso_shop_item": items}


# ---------------------------------------------------------------- CAPSO! gacha
def _reward_locks(raw: dict[str, Any], where: str) -> dict[str, str]:
    locks = _object(raw, "RewardLocks", where)
    return {
        "im_topic_id": str(locks.get("IMTopicId") or ""),
        "os_file_id": str(locks.get("OSFileId") or ""),
        "story_lock_id": str(locks.get("StoryLockId") or ""),
    }


def build_gacha(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    machine_table = source.json_or_bundle(
        (("gacharewarddata", "gachamachines"), ("gachamachines",)),
        "gacharewarddata.ab",
        "gachamachines",
    )
    reward_table = source.json_or_bundle(
        (("gacharewarddata", "gachareward"), ("gachareward",)),
        "gacharewarddata.ab",
        "gachareward",
    )

    machines: list[dict[str, Any]] = []
    for index, raw in enumerate(_rows(machine_table, "gacha machine")):
        locator = f"{machine_table.locator}[{index}]"
        machine_id = str(_required(raw, "ID", locator))
        machines.append(
            {
                "id": entity_key("gacha_machine", machine_id),
                "type": "gacha_machine",
                "game_id": machine_id,
                "name": str(raw.get("Name") or ""),
                "create_order": _integer(raw, "CreateOrder", locator),
                "icon_path": str(raw.get("IconPath") or ""),
                "default_price": str(raw.get("DefaultPrice") or ""),
                "provenance": [_text_asset(locator)],
            }
        )

    rewards: list[dict[str, Any]] = []
    for index, raw in enumerate(_rows(reward_table, "gacha reward")):
        locator = f"{reward_table.locator}[{index}]"
        reward_id = str(_required(raw, "Id", locator))
        machine_id = str(_required(raw, "Gacha Machine ID", locator))
        reward_type = _integer(raw, "Type", locator)
        record: dict[str, Any] = {
            "id": entity_key("gacha_reward", reward_id),
            "type": "gacha_reward",
            "game_id": reward_id,
            "machine_id": entity_key("gacha_machine", machine_id),
            "reward_type": reward_type,
            "weight": _integer(raw, "Weight", locator),
            "create_order": _integer(raw, "CreateOrder", locator),
            "secret": _boolean(raw, "IsSecret", locator),
            "reward_locks": _reward_locks(raw, locator),
            "provenance": [_text_asset(locator)],
        }
        if reward_type == 0:
            song, difficulties = _split_chart_id(reward_id, locator)
            record["kind"] = "chart"
            record["song_id"] = song_key(song)
            record["chart_ids"] = [
                chart_key(song, difficulty) for difficulty in difficulties
            ]
        elif reward_type == 1:
            record["kind"] = "illustration"
            record["illustration_id"] = entity_key("illustration", reward_id)
        elif reward_type == 2:
            record["kind"] = "tap_fx"
            record["tap_fx_id"] = reward_id
        elif reward_type == 3:
            record["kind"] = "song"
            record["song_id"] = song_key(reward_id)
        else:
            raise BuildError(f"{locator}: unknown reward Type {reward_type}")
        rewards.append(record)

    return {"gacha_machine": machines, "gacha_reward": rewards}


# --------------------------------------------------------------- shop bundles
_BUNDLE_ITEM_TYPES = ("Character", "ExpansionPack")


def build_shop_bundles(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    table = source.json_or_bundle(
        (("bundle_sale_data",), ("sharedassets0", "bundle_sale_data")),
        "sharedassets0.assets",
        "bundle_sale_data",
    )
    if not isinstance(table.data, dict):
        raise InputError(f"{table.locator} must be a JSON object")
    bundles: list[dict[str, Any]] = []
    for index, raw in enumerate(_array(table.data, "Bundles", table.locator)):
        locator = f"{table.locator}/Bundles[{index}]"
        if not isinstance(raw, dict):
            raise BuildError(f"{locator}: must be an object")
        bundle_key = str(_required(raw, "BundleKey", locator))

        items = []
        for item_index, raw_item in enumerate(_array(raw, "Items", locator)):
            item_locator = f"{locator}.Items[{item_index}]"
            if not isinstance(raw_item, dict):
                raise BuildError(f"{item_locator}: must be an object")
            item_type = str(_required(raw_item, "ItemType", item_locator))
            if item_type not in _BUNDLE_ITEM_TYPES:
                raise BuildError(
                    f"{item_locator}: unknown ItemType {item_type!r}; "
                    f"expected one of {', '.join(_BUNDLE_ITEM_TYPES)}"
                )
            items.append(
                {
                    "product_id": str(
                        _required(raw_item, "ProductId", item_locator)
                    ),
                    "item_type": item_type,
                    "weight": _integer(raw_item, "Weight", item_locator),
                    "reference_price_iap_id": str(
                        raw_item.get("ReferencePriceIapId") or ""
                    ),
                    "preorder": _boolean(raw_item, "IsPreorder", item_locator),
                }
            )

        tiers = []
        for tier_index, raw_tier in enumerate(_array(raw, "Tiers", locator)):
            tier_locator = f"{locator}.Tiers[{tier_index}]"
            if not isinstance(raw_tier, dict):
                raise BuildError(f"{tier_locator}: must be an object")
            tiers.append(
                {
                    "remain_weight": _integer(raw_tier, "RemainWeight", tier_locator),
                    "iap_id": str(_required(raw_tier, "IapId", tier_locator)),
                }
            )

        bundles.append(
            {
                "id": entity_key("shop_bundle", bundle_key),
                "type": "shop_bundle",
                "game_id": bundle_key,
                "milestone_key": str(raw.get("MilestoneKey") or ""),
                "trigger_free_character_level": _integer(
                    raw, "TriggerFreeCharacterLevel", locator
                ),
                "black_market": _boolean(raw, "BlackMarketTrigger", locator),
                "message_ids": {
                    "purchased": str(raw.get("PurchasedMessageId") or ""),
                    "purchased_preorder": str(
                        raw.get("PurchasedPreorderMessageId") or ""
                    ),
                    "panel_description": str(raw.get("PanelDescriptionId") or ""),
                    "panel_warning": str(raw.get("PanelWarningId") or ""),
                    "tab_title": str(raw.get("TabTitleId") or ""),
                },
                "items": items,
                "tiers": tiers,
                "provenance": [_text_asset(locator)],
            }
        )
    return {"shop_bundle": bundles}


# ------------------------------------------------------------------- build
def build(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    entities: dict[str, list[dict[str, Any]]] = {}
    entities.update(build_capso_shop(source))
    entities.update(build_gacha(source))
    entities.update(build_shop_bundles(source))
    return entities
