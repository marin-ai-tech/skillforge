---
title: Help assistant
summary: The help assistant answers questions about SkillForge from this help, in your interface language. It is read-only: it explains how to do things but never changes anything.
section: start
learn:
  - What the help assistant can and cannot do
  - How the Getting started and Ask a question modes differ
  - Where to open the assistant and who may use it
  - What happens to your conversation and when to double-check an answer
related: pages/help, pages/admin-assistant
---

The help assistant is a chat built into the Help center. It answers questions about SkillForge from the topics of this help, in your interface language: in the English interface it reads the English help and answers in English, and in another installed language it does the same in that language. When it points you somewhere, it links to help topics. Links in answers open only pages inside the help; any other address is shown as plain text.

The assistant is read-only. It does not publish, move artifacts through the lifecycle or change settings, and it does not see registry data such as artifacts, metrics or users. It knows only the help and your role, so it can explain how to do something and which page to open, but you take the steps yourself.

## Turning it on

The assistant is off until an administrator connects a model and turns it on (the Assistant and LLM page at `/admin/assistant`). While it is off, the Help center has no Assistant tab and the side help panel has no button for it. If you expect the assistant and do not see it, ask your administrator.

## Opening the assistant

- In the Help center, choose the **Assistant** tab next to **Help topics**. It opens in the **Getting started** mode.
- In the side help panel (press `?` on any page), choose **Ask the assistant**. The assistant opens in the **Ask a question** mode and knows which page you came from, so you can ask about that page directly.

To go back to reading topics, choose the **Help topics** tab.

## Two modes

- **Getting started** is for new users. The assistant starts the conversation itself: it first asks what you want to do and which agent tool you use, then suggests a step-by-step path through the help.
- **Ask a question** answers your question. If the question is ambiguous, the assistant first asks one or two clarifying questions.

Switch modes with the buttons at the top of the chat; switching starts a new conversation. Enter sends a message and Shift+Enter starts a new line. **Stop** interrupts an answer that is being written, and **New conversation** clears the current one.

## Who can use it

Any signed-in user, whatever the role. Visitors who are not signed in see an invitation to sign in instead of the chat. API tokens used by agents through MCP cannot call the assistant. The administrator may set a daily limit of requests per user: the number of requests left today is shown under the input, and once it reaches zero the assistant is available again the next day (days are counted in UTC).

## Privacy

- Conversations are not stored on the server. The server keeps only daily counters of requests and tokens per user, without any text.
- The conversation history lives in this browser tab. It survives a page reload, but closing the tab or choosing **New conversation** removes it, and other tabs and devices do not see it.
- Your messages go to the model provider that the administrator connected, which may be an external service.
- When SkillForge works for Agent Space, the chat has a field for an **Agent Space task budget grant** (`assistant-budget-grant`): the answers are then paid from that task's budget. The grant is sent with each question and kept only while the page is open — not in the conversation history, not on the server. Leave it empty to use the shared budget. If Agent Space refuses the grant (it was revoked or has expired, or its task is no longer claimed), the chat says so with `budget_grant_rejected`: get a new grant and ask again.

> [!WARNING]
> Do not paste passwords, API tokens, keys or other secrets into the chat. The assistant never needs them, and the text of every message is sent to the model provider.

## When answers can be wrong

The assistant writes its answers with a language model, and models make mistakes. It may misread the help, mix up two similar features or describe a button that does not exist, more often with small local models or with questions the help does not cover. Treat an answer as a pointer: open the linked help topics and check the steps there before you act, especially before irreversible operations such as purging an artifact or deleting a backup. If an answer contradicts the help, the help is right.
