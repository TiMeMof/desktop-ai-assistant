from __future__ import annotations

import unittest

from assistant_daemon.providers import ModelClient, ollama_payload, openai_payload
from assistant_daemon.schemas import ProviderConfig


class ProviderPayloadTests(unittest.TestCase):
    def test_openai_payload(self) -> None:
        provider = ProviderConfig(
            id="p",
            type="openai_compatible",
            base_url="http://127.0.0.1:8000/v1",
            model="test-model",
        )
        payload = openai_payload(provider, [{"role": "user", "content": "hi"}], stream=True)
        self.assertEqual(payload["model"], "test-model")
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["messages"][0]["content"], "hi")

    def test_ollama_payload(self) -> None:
        provider = ProviderConfig(
            id="o",
            type="ollama",
            base_url="http://127.0.0.1:11434",
            model="qwen2.5:7b",
        )
        payload = ollama_payload(provider, [{"role": "user", "content": "hi"}], stream=False)
        self.assertEqual(payload["model"], "qwen2.5:7b")
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["options"]["temperature"], 0.3)

    def test_anthropic_payload_uses_top_level_system(self) -> None:
        provider = ProviderConfig(
            id="a",
            type="anthropic",
            base_url="https://api.anthropic.com/v1",
            model="claude-sonnet-4-5",
        )
        payload = ModelClient(provider)._payload(
            [
                {"role": "system", "content": "be concise"},
                {"role": "user", "content": "hi"},
            ],
            stream=True,
        )
        self.assertEqual(payload["system"], "be concise")
        self.assertEqual(payload["messages"], [{"role": "user", "content": "hi"}])
        self.assertTrue(payload["stream"])

    def test_qianfan_payload_folds_system_into_user_message(self) -> None:
        provider = ProviderConfig(
            id="b",
            type="baidu_qianfan",
            base_url="https://aip.baidubce.com",
            model="ernie-4.0-turbo-8k",
        )
        payload = ModelClient(provider)._payload(
            [
                {"role": "system", "content": "be concise"},
                {"role": "user", "content": "hi"},
            ],
            stream=False,
        )
        self.assertEqual(payload["messages"][0]["role"], "user")
        self.assertIn("be concise", payload["messages"][0]["content"])
        self.assertIn("hi", payload["messages"][0]["content"])
        self.assertFalse(payload["stream"])


if __name__ == "__main__":
    unittest.main()
