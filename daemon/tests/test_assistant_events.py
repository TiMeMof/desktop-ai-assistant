from __future__ import annotations

import unittest

from assistant_daemon.assistant_events import assistant_event_for_action, done_payload


class AssistantEventTests(unittest.TestCase):
    def test_translate_event_suggests_followups(self) -> None:
        event = assistant_event_for_action("translate", "test-provider")
        payload = done_payload("translated text", {"provider_id": "test-provider"}, event)

        self.assertEqual(payload["assistant_event"]["state"], "asking_followup")
        self.assertEqual(payload["emotion"], "happy")
        self.assertEqual(payload["motion"], "ask")
        self.assertEqual(payload["assistant_event"]["suggestions"][0]["action_id"], "polish")
        self.assertEqual(payload["assistant_event"]["suggestions"][1]["action_id"], "explain")
        self.assertEqual(payload["assistant_event"]["suggestions"][2]["mode"], "chat")


if __name__ == "__main__":
    unittest.main()
