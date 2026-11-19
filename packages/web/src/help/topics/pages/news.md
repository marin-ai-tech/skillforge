---
title: News
summary: News is the shared feed of what changed in the registry since your last visit, plus posts from admins and team leads. Use it to catch up in a minute and see what concerns you.
section: ui-workspace
learn:
  - What the pinned posts, day groups and automatic items show
  - How to filter the feed by kind and artifact type
  - How the unread count in the header works
  - Who can write a post and for which audience, and how to edit, delete or finish a draft
related: pages/notifications, actions/news/news-new, actions/news/news-filter, actions/news/news-more, actions/news/news-publish
---

## What this page is for

`/news` answers one question: what changed in the registry since you last looked, and what of it concerns you. The registry writes automatic news when an artifact first becomes active, when a new stable version appears, and when an artifact goes zombie, is retired or comes back. Admins and team leads add posts with announcements for their people.

## What you see

Pinned posts come first (`news-pinned`). Below them the feed is grouped by day under the headings **Today**, **Yesterday** or a date; every row is a `news-item`. An automatic item names the artifact as a link: a new version opens the comparison with the previous stable version. A post shows its title, its Markdown text, the author and the audience; an important post says **Important** in words, not only by colour. **Show more** loads the next page and moves the focus to the first new item; if that page fails, the error appears next to the button and only that page is retried. If you can post, the section **Drafts and scheduled** (`news-drafts`) above the filters lists the drafts and the posts waiting for their publication time; it is hidden when there are none. A post you may change shows **Edit** and **Delete** on its row, in the feed, among the pinned posts and in the drafts. When you opened the page with unread news, the line under the title says how many are new since your last visit, and the separator **Earlier — already seen** marks where they end.

## Common tasks

Filter by kind or artifact type: the choice is kept in the address, for example `/news?kind=post`, so you can bookmark or share it. When nothing matches, **Reset filters** returns to the whole feed. Opening the page marks the feed seen, and the count next to **News** in the header goes away. Under a filter the pinned posts are not shown, because they are not filtered. To announce something, press **New post**, write the text, check it in the preview, choose the audience (an admin always chooses it; the button then names it, for example **Publish for everyone**) and publish it now, later, or save a draft; the line under the title confirms what happened. Times are in your local time zone, at most 365 days ahead. To come back to a draft, open it from **Drafts and scheduled** with **Edit** and publish it. **Delete** asks for a confirmation first; **Cancel** asks before it throws away typed text.

## Permissions

You only see news you are allowed to see: items about artifacts of another team and posts for another team are not shown, and the feed follows visibility changes at once. An admin can post for everyone or for any team; a team lead only for the teams they lead. Edit and Delete appear only on posts you may change: an admin any post, a team lead the posts for the teams they lead. Other users do not get the **New post** button at all.
