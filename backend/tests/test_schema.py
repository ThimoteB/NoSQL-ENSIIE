from unittest.mock import MagicMock

from app.database import initialize_schema


def test_initialization_creates_validators_indexes_and_catalogs():
    database = MagicMock()
    database.list_collection_names.return_value = []
    initialize_schema(database)
    collections = {
        call.args[0]: call.kwargs for call in database.create_collection.call_args_list
    }
    assert set(collections) == {"players", "encounters", "species", "biomes"}
    for options in collections.values():
        assert options["validationAction"] == "error"
        assert options["validationLevel"] == "strict"
        assert options["validator"]["$jsonSchema"]["additionalProperties"] is False
    player_schema = collections["players"]["validator"]["$jsonSchema"]
    assert "minecraft_uuid" in player_schema["properties"]
    assert "minecraft_uuid" not in player_schema["required"]
    encounter_schema = collections["encounters"]["validator"]["$jsonSchema"]
    assert "coordinates" not in encounter_schema["properties"]["location"]["properties"]
    assert "encountered_at" not in encounter_schema["properties"]
    database.players.create_index.assert_called_once_with("username_normalized", unique=True)
    assert database.encounters.create_index.call_count == 4
    assert database.__getitem__.return_value.replace_one.call_count > 4


def test_initialization_updates_existing_validators():
    database = MagicMock()
    database.list_collection_names.return_value = [
        "players", "encounters", "species", "biomes"
    ]
    initialize_schema(database)
    database.create_collection.assert_not_called()
    assert database.command.call_count == 4
    assert all(call.args[0] == "collMod" for call in database.command.call_args_list)
