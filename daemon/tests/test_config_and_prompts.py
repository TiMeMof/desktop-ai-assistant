from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from assistant_daemon.config import CONFIG_ROOT, ConfigError, Settings
from assistant_daemon.prompts import build_messages
from assistant_daemon.schemas import SettingsUpdate, UserSettings


class ConfigAndPromptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(CONFIG_ROOT)

    def test_loads_app_characters_actions_and_providers(self) -> None:
        self.assertIn("translate", self.settings.actions)
        self.assertIn("explain", self.settings.actions)
        self.assertIn("polish", self.settings.actions)
        self.assertIn("default", self.settings.characters)
        self.assertIn("maid", self.settings.characters)
        self.assertIn("liangzi-perspective", self.settings.characters)
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

    def test_builds_messages_with_skill_character(self) -> None:
        messages = build_messages(
            self.settings.characters["liangzi-perspective"],
            self.settings.actions["explain"],
            self.settings.prompt_profiles["default"],
            "这波流量值不值",
        )
        self.assertIn("local character skill", messages[0]["content"])
        self.assertIn("良子 · 胃袋流量操作系统", messages[0]["content"])
        self.assertIn("这波流量值不值", messages[1]["content"])

    def test_summary_hides_api_key_values(self) -> None:
        summary = self.settings.summary()
        self.assertIn("providers", summary)
        rendered = str(summary)
        self.assertNotIn("OPENAI_API_KEY", rendered)
        self.assertNotIn("DEEPSEEK_API_KEY", rendered)

    def test_presentation_defaults_to_fbx(self) -> None:
        settings = UserSettings()
        self.assertEqual(settings.presentation["renderer"], "fbx")

    def test_saves_valid_presentation_renderers(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_root = Path(shutil.copytree(CONFIG_ROOT, f"{temp_dir}/config"))
            settings = Settings(config_root)

            saved = settings.save_user_settings(SettingsUpdate(presentation={"renderer": "live2d"}))
            self.assertEqual(saved.presentation["renderer"], "live2d")

            saved = settings.save_user_settings(SettingsUpdate(presentation={"renderer": "fbx"}))
            self.assertEqual(saved.presentation["renderer"], "fbx")

    def test_rejects_invalid_presentation_renderer(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_root = Path(shutil.copytree(CONFIG_ROOT, f"{temp_dir}/config"))
            settings = Settings(config_root)

            with self.assertRaises(ConfigError):
                settings.save_user_settings(SettingsUpdate(presentation={"renderer": "webgl"}))


if __name__ == "__main__":
    unittest.main()
