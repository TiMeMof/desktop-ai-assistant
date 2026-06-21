from __future__ import annotations

import unittest

from assistant_daemon.config import CONFIG_ROOT, Settings
from assistant_daemon.prompts import build_messages


class ConfigAndPromptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(CONFIG_ROOT)

    def test_loads_app_characters_actions_and_providers(self) -> None:
        self.assertIn("translate", self.settings.actions)
        self.assertIn("explain", self.settings.actions)
        self.assertIn("polish", self.settings.actions)
        self.assertIn("default", self.settings.characters)
        self.assertIn("maid", self.settings.characters)
        self.assertIn("default", self.settings.prompt_profiles)
        self.assertIn("ollama-qwen", self.settings.providers)

    def test_builds_messages_with_character_and_action(self) -> None:
        messages = build_messages(
            self.settings.characters["default"],
            self.settings.actions["translate"],
            self.settings.prompt_profiles["default"],
            "Hello world",
        )
        self.assertEqual(messages[0]["role"], "system")
        self.assertEqual(messages[1]["role"], "user")
        self.assertIn("Hello world", messages[1]["content"])
        self.assertIn("Style rules", messages[0]["content"])
        self.assertIn("User preference injection", messages[0]["content"])

    def test_summary_hides_api_key_values(self) -> None:
        summary = self.settings.summary()
        self.assertIn("providers", summary)
        rendered = str(summary)
        self.assertNotIn("OPENAI_API_KEY", rendered)
        self.assertNotIn("DEEPSEEK_API_KEY", rendered)


if __name__ == "__main__":
    unittest.main()
