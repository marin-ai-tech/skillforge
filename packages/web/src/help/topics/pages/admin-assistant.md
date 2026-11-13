---
title: Assistant and LLM
summary: The admin page where you connect an OpenAI-compatible model for the read-only help assistant. Use it to turn the assistant on, set the model and limits, test the connection and watch usage.
section: ui-admin
learn:
  - What each assistant setting means and its allowed range
  - Why the API key comes only from the server environment and where it is sent
  - How to connect a hosted provider or a local server and test the connection
  - How to read the usage numbers and who may change the settings
related: getting-started/assistant, getting-started/self-hosting
---

## What this page is for

Assistant and LLM at `/admin/assistant` is where an administrator connects a language model for the help assistant, the read-only chat in the Help center. SkillForge works with any OpenAI-compatible chat API: OpenAI, OpenRouter or a local server such as Ollama or vLLM. Every setting except the API key is stored in the database and edited here. The assistant is off by default, and nothing changes for users until you save an API address and a model and turn it on.

The API key is not a setting on this page. The server operator sets it in `SKILLFORGE_LLM_API_KEY`; SkillForge reads it at startup, never stores it in the database, never returns it from the API and masks it in logs. The key is sent in the `Authorization` header only when the origin of the API address (scheme, host and port) is listed in `SKILLFORGE_LLM_KEY_ORIGINS`. The reason is that the address is edited by an application admin, while the key belongs to whoever runs the host: without the list, an admin could point the address at their own server and receive the key. If the list is empty, the key is never sent. Local servers such as Ollama or vLLM need no key.

## What you see

- **Turn the assistant on** (`llm-enabled`): shows the Assistant tab in the Help center and the **Ask the assistant** button in the side help panel to every signed-in user.
- **API address (OpenAI-compatible)** (`llm-base-url`): for example `https://api.openai.com/v1` or `http://localhost:11434/v1`. Only `http:` and `https:` addresses without a user name or password are accepted; SkillForge calls `/chat/completions` under this address.
- **Model** (`llm-model`): the model name exactly as the provider spells it.
- **API key** (`llm-key-status`): whether the key is set in the server environment and whether it is sent to the saved address. The value of the key is never shown. With an Agent Space budget broker (`SKILLFORGE_BUDGET_SOCKET`) it says that the broker holds the key: every model call goes through the broker, and the address must be one of the providers it serves (DeepSeek, OpenAI, Gemini).
- **Temperature (0–2)**: lower values give steadier answers; the default is 0.2.
- **Longest answer, tokens (64–8192)**: the cap on one answer; the default is 1024.
- **Timeout, seconds (5–300)**: how long to wait for the model; the default is 60.
- **Requests per user per day (0 — no limit)**: the default is 50.
- **Help topics in the context (1–12)**: how many help topics closest to the question are sent to the model with it; the default is 6. More topics give fuller answers but cost more tokens and may not fit a small local model.
- **Skill checks** (`llm-validation`): whether published skills are checked with this model, what leaves the server, and the budget. See [the independent review assistant](getting-started/review-assistant).
- **Save** and **Test connection**, with the result next to the buttons.
- **Usage** (`llm-usage`): **Today** and **Last 30 days**, each with requests, users, and tokens in and out. Days are counted in UTC.

> [!CAUTION]
> Never put the API key into the address, the model name or any other field on this page. These settings are stored in the database and visible to every admin; the key belongs only in the server environment. If a key ended up in a field or in a chat, revoke it at the provider and issue a new one.

## Common tasks

1. Open **Assistant** in the user menu (`menu-admin-assistant`) or go to `/admin/assistant`.
2. Connect a hosted provider: ask the server operator to set `SKILLFORGE_LLM_API_KEY`, add the provider origin such as `https://api.openai.com` to `SKILLFORGE_LLM_KEY_ORIGINS` and restart the server. Then enter the API address and the model and choose **Save**; the API key block confirms that the key is sent to this address.
3. Connect a local server: start Ollama or vLLM, enter its address such as `http://localhost:11434/v1` and the model name, and save. No key and no origin list are needed.
4. Choose **Test connection**. It sends a short test request with the saved settings and shows the model and the delay in milliseconds, or why the connection failed, for example that the provider rejected the key or the model did not answer in time. Save your edits before testing.
5. Select **Turn the assistant on** and save. The Assistant tab appears in the Help center.
6. After a few days, check **Usage** and adjust the daily limit and the number of help topics in the context.

## Permissions

Requires role admin. Viewer, contributor and reviewer see `admin-forbidden` on this page and receive 403 from `GET /api/v1/admin/llm`, `PUT /api/v1/admin/llm` and `POST /api/v1/admin/llm/test`. Anonymous users are redirected to `/login?next=/admin/assistant`. Each settings change is written to the server log with the admin's name and the changed fields, never with the key. An admin can neither read nor set the key through the interface or the API: only the server operator changes it, in the environment, followed by a restart. The assistant itself is open to any signed-in user; conversations are not stored on the server, so this page shows only counters.
