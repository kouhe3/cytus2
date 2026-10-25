"""The game's ``##json=msgs`` OS bodies are phone transcripts.

Eight OS logs store their body as one JSON message list instead of the
conversation script, so the parser must turn it into a chat block rather than
collapsing the whole body into a bare ``msgs`` note.
"""

from __future__ import annotations


def test_msgs_becomes_a_chat_block() -> None:
    from cytus2db.blocks import parse_blocks

    body = (
        "##json=msgs\n"
        '[{"MessageType": 2,"Content": "You there","UserName": "Linda",'
        '"Avatar": "Linda_os_01","Time": "PM 03:43"},'
        '{"MessageType": 1,"Content": "YEP !!!!","Avatar": "neko_os_01",'
        '"Time": "PM 03:44"}]'
    )

    assert parse_blocks(body) == [
        {
            "kind": "msgs",
            "messages": [
                {
                    "side": "incoming",
                    "text": "You there",
                    "name": "Linda",
                    "avatar": "Linda_os_01",
                    "time": "PM 03:43",
                },
                {
                    "side": "outgoing",
                    "text": "YEP !!!!",
                    "avatar": "neko_os_01",
                    "time": "PM 03:44",
                },
            ],
        }
    ]


def test_msgs_maps_system_and_image_messages() -> None:
    from cytus2db.blocks import parse_blocks

    body = (
        "##json=msgs\n"
        '[{"MessageType": 0,"Content": "[JOE is offline]","Avatar": "","Time": ""},'
        '{"MessageType": 3,"Image": "07_CatXD","IsImageClickable": false,'
        '"Avatar": "neko_os_01","Time": "PM 03:44"}]'
    )

    assert parse_blocks(body)[0]["messages"] == [
        {"side": "system", "text": "[JOE is offline]"},
        {
            "side": "outgoing",
            "image": "07_CatXD",
            "avatar": "neko_os_01",
            "time": "PM 03:44",
        },
    ]


def test_msgs_keeps_literal_newlines_inside_a_message() -> None:
    """The asset ships raw line breaks inside ``Content``; strict JSON rejects
    them, which is how these bodies lost their text in the first place."""
    from cytus2db.blocks import parse_blocks

    body = (
        "##json=msgs\n"
        '[{"MessageType": 1,"Content": "first line\nsecond line",'
        '"Avatar": "cherry_os_01","Time": "AM 06:59"}]'
    )

    assert parse_blocks(body) == [
        {
            "kind": "msgs",
            "messages": [
                {
                    "side": "outgoing",
                    "text": "first line\nsecond line",
                    "avatar": "cherry_os_01",
                    "time": "AM 06:59",
                }
            ],
        }
    ]


def test_empty_msgs_payload_keeps_the_note_fallback() -> None:
    from cytus2db.blocks import parse_blocks

    assert parse_blocks("##json=msgs\n[]") == [
        {"kind": "note", "directive": "json", "value": "msgs"}
    ]
