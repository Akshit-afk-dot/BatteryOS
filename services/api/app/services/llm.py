"""Thin wrapper around the Anthropic Messages API.

The model never sees credentials or performs writes. Callers pass in exactly
the data it may use and validate whatever comes back.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import anthropic

from ..config import get_settings

log = logging.getLogger("batteryos.llm")

# Server-side fallback: if the model declines for policy reasons, the API
# re-runs the request on Anthropic's recommended fallback model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AIUnavailable(Exception):
    """No API key configured, or AI disabled for this deployment."""


class AIError(Exception):
    """The model call failed or returned something unusable."""


_client: anthropic.Anthropic | None = None


def is_configured() -> bool:
    return get_settings().ai_configured


def model_name() -> str:
    return get_settings().anthropic_model


def client() -> anthropic.Anthropic:
    global _client
    settings = get_settings()
    if not settings.ai_configured:
        raise AIUnavailable("AI assistant is not configured (set ANTHROPIC_API_KEY).")
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=120.0, max_retries=2)
    return _client


def _call(**kwargs: Any):
    try:
        return client().beta.messages.create(
            model=model_name(),
            betas=[FALLBACK_BETA],
            fallbacks="default",
            **kwargs,
        )
    except anthropic.AuthenticationError as e:
        raise AIError("The AI provider rejected the API key. Check ANTHROPIC_API_KEY.") from e
    except anthropic.RateLimitError as e:
        raise AIError("The AI provider is rate limiting requests. Try again in a minute.") from e
    except anthropic.BadRequestError as e:
        log.warning("AI bad request: %s", e)
        raise AIError(f"The AI request was rejected: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"The AI provider returned an error ({e.status_code}). Try again later.") from e
    except anthropic.APIConnectionError as e:
        raise AIError("Could not reach the AI provider. Check the network connection.") from e


def _check_stop(resp) -> None:
    if resp.stop_reason == "refusal":
        raise AIError("The AI model declined this request. Write this section manually instead.")
    if resp.stop_reason == "max_tokens":
        raise AIError("The AI response was cut off before it finished. Try selecting fewer records.")


def structured(
    *, system: str, user: str, schema: dict[str, Any], effort: str = "medium", max_tokens: int = 16000
) -> dict[str, Any]:
    """One request whose response is constrained to `schema` (JSON)."""
    resp = _call(
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    _check_stop(resp)
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise AIError("The AI model returned an empty response.")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise AIError("The AI model returned malformed JSON.") from e


def tool_turn(*, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]], effort: str = "low"):
    """One step of a tool-use conversation. The caller runs the loop."""
    resp = _call(
        max_tokens=8000,
        system=system,
        messages=messages,
        tools=tools,
        output_config={"effort": effort},
    )
    if resp.stop_reason == "refusal":
        raise AIError("The AI model declined this request.")
    return resp
