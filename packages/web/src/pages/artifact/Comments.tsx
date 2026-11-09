import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createComment,
  deleteComment,
  listComments,
  patchComment,
  type CommentDto,
} from "../../api/client.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { CommentBody } from "../../lib/comment-text.tsx";
import { roleAtLeast, useMe } from "../../lib/auth.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";

type Props = {
  type: string;
  name: string;
  versions: string[];
  selectedVersion: string;
};

function commentErrorText(err: unknown): string {
  const t = STR.art.comments.errors;
  if (err instanceof ApiError) {
    const code = err.error;
    if (code === "comment_invalid") return t.invalid;
    if (code === "rate_limited") return t.rateLimited;
    if (code === "forbidden") return t.forbidden;
    if (code === "not_found") return t.notFound;
    if (code === "mcp_token_forbidden") return t.mcpForbidden;
    if (err.message && err.message !== code) return `${errorText(err)} (${code})`;
    return t.requestFailedCode(code);
  }
  return STR.art.common.requestFailed;
}

/** Own (non-deleted) comments are editable; deletable by the author or a moderator. */
function commentPermissions(
  comment: CommentDto,
  username: string | undefined,
  canModerate: boolean,
): { canEdit: boolean; canDelete: boolean } {
  const me = username;
  const isOwn = !!me && me.toLowerCase() === comment.author.toLowerCase();
  const canEdit = isOwn && !comment.deleted;
  const canDelete = !comment.deleted && (isOwn || canModerate);
  return { canEdit, canDelete };
}

function CommentMeta({ comment }: { comment: CommentDto }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="font-medium text-ink" translate="no">
        {comment.author}
      </span>
      {comment.version ? <span className="font-mono">v{comment.version}</span> : null}
      {comment.ref ? (
        <span className="rounded-sf bg-surface-2 px-1.5 py-0.5" title={STR.art.comments.refTitle}>
          {STR.art.comments.finding} <span translate="no">{comment.ref}</span>
        </span>
      ) : null}
      <span>{formatDateTime(comment.created_at)}</span>
      {comment.edited_at ? <span>{STR.art.comments.edited}</span> : null}
    </div>
  );
}

function CommentRow({
  comment,
  depth,
  type,
  name,
  username,
  canModerate,
  onReply,
}: {
  comment: CommentDto;
  depth: number;
  type: string;
  name: string;
  username: string | undefined;
  canModerate: boolean;
  onReply: (id: string) => void;
}) {
  const { canEdit, canDelete } = commentPermissions(comment, username, canModerate);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const patchMut = useMutation({
    mutationFn: () => patchComment(comment.id, editBody.trim()),
    onSuccess: async () => {
      setEditing(false);
      setRowError(null);
      await qc.invalidateQueries({ queryKey: ["comments", type, name] });
    },
    onError: (err: unknown) => setRowError(commentErrorText(err)),
  });

  const delMut = useMutation({
    mutationFn: () => deleteComment(comment.id),
    onSuccess: async () => {
      setConfirmOpen(false);
      setRowError(null);
      await qc.invalidateQueries({ queryKey: ["comments", type, name] });
      await qc.invalidateQueries({ queryKey: ["artifact", type, name] });
    },
    onError: (err: unknown) => setRowError(commentErrorText(err)),
  });

  return (
    <li
      data-testid="comment-row"
      data-comment-id={comment.id}
      className={`rounded-sf border border-line bg-surface p-3 ${depth > 0 ? "ml-6" : ""}`}
    >
      <CommentMeta comment={comment} />
      {comment.deleted ? (
        <p className="mt-2 text-sm italic text-muted">{STR.art.comments.deleted}</p>
      ) : editing ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            patchMut.mutate();
          }}
        >
          <textarea
            className="w-full rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
            rows={3}
            maxLength={4000}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
              disabled={patchMut.isPending || editBody.trim() === ""}
            >
              {STR.art.common.save}
            </button>
            <button
              type="button"
              className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
              onClick={() => {
                setEditing(false);
                setEditBody(comment.body);
              }}
            >
              {STR.art.common.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-2">
          <CommentBody text={comment.body} />
        </div>
      )}
      {!comment.deleted && username ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid={`comment-reply-${comment.id}`}
            className="text-xs text-accent underline"
            onClick={() => onReply(comment.id)}
          >
            {STR.art.comments.reply}
          </button>
          {canEdit ? (
            <button
              type="button"
              data-testid={`comment-edit-${comment.id}`}
              className="text-xs text-accent underline"
              onClick={() => setEditing(true)}
            >
              {STR.art.comments.edit}
            </button>
          ) : null}
          {canDelete ? (
            <HelpTip action="comment-delete">
              <button
                type="button"
                data-testid={`comment-delete-${comment.id}`}
                className="text-xs text-danger underline"
                onClick={() => setConfirmOpen(true)}
              >
                {STR.art.comments.delete}
              </button>
            </HelpTip>
          ) : null}
        </div>
      ) : null}
      {rowError ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {rowError}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title={STR.art.comments.deleteTitle}
        body={STR.art.comments.deleteBody}
        helpText={STR.art.comments.deleteHelp}
        helpTopic="actions/artifact/comment-delete"
        confirmLabel={STR.art.comments.delete}
        onConfirm={() => delMut.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
      {comment.replies && comment.replies.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {comment.replies.map((r) => (
            <CommentRow
              key={r.id}
              comment={r}
              depth={depth + 1}
              type={type}
              name={name}
              username={username}
              canModerate={canModerate}
              onReply={onReply}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Comments({ type, name, versions, selectedVersion }: Props) {
  const me = useMe();
  const user = me.data ?? null;
  const canModerate = roleAtLeast(user?.role, "reviewer");
  const qc = useQueryClient();
  const [versionFilter, setVersionFilter] = useState<string>("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const commentsQ = useQuery({
    queryKey: ["comments", type, name, versionFilter],
    queryFn: () => listComments(type, name, versionFilter ? { version: versionFilter } : {}),
    staleTime: 15_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createComment(type, name, {
        body: body.trim(),
        ...(versionFilter || selectedVersion ? { version: versionFilter || selectedVersion } : {}),
        ...(replyTo ? { parent_id: replyTo } : {}),
      }),
    onSuccess: async () => {
      setBody("");
      setReplyTo(null);
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["comments", type, name] });
      await qc.invalidateQueries({ queryKey: ["artifact", type, name] });
    },
    onError: (err: unknown) => setFormError(commentErrorText(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (body.trim() === "") {
      setFormError(STR.art.comments.errors.required);
      return;
    }
    createMut.mutate();
  }

  return (
    <div className="space-y-4" data-testid="comments-tab">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 text-muted">
          {STR.art.comments.versionFilter}
          <select
            data-testid="comments-version-filter"
            className="rounded-sf border border-line bg-bg px-2 py-1 font-mono text-sm text-ink"
            value={versionFilter}
            onChange={(e) => setVersionFilter(e.target.value)}
          >
            <option value="">{STR.art.comments.allVersions}</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {user ? (
        <form
          className="space-y-2 rounded-sf border border-line bg-surface p-4 text-sm"
          onSubmit={submit}
        >
          <h2 className="font-medium">
            {replyTo ? STR.art.comments.replyTo(replyTo.slice(0, 8)) : STR.art.comments.newComment}
          </h2>
          {replyTo ? (
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() => setReplyTo(null)}
            >
              {STR.art.comments.cancelReply}
            </button>
          ) : null}
          <textarea
            data-testid="comment-body"
            aria-label={STR.art.comments.bodyLabel}
            rows={3}
            maxLength={4000}
            className="w-full rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={STR.art.comments.placeholder}
          />
          <div className="flex items-center gap-2">
            <HelpTip action="comment-submit">
              <button
                type="submit"
                data-testid="comment-submit"
                disabled={createMut.isPending || body.trim() === ""}
                className="rounded-sf border border-line px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                {STR.art.comments.post}
              </button>
            </HelpTip>
            {formError ? (
              <p data-testid="comment-error" role="alert" className="text-xs text-danger">
                {formError}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      {commentsQ.isError ? (
        <p className="text-sm text-danger">{STR.art.comments.loadFailed}</p>
      ) : commentsQ.isLoading || !commentsQ.data ? (
        <p className="text-sm text-muted">{STR.common.loading}</p>
      ) : commentsQ.data.items.length === 0 ? (
        <EmptyState title={STR.art.comments.empty} />
      ) : (
        <ul className="space-y-3">
          {commentsQ.data.items.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              depth={0}
              type={type}
              name={name}
              username={user?.username}
              canModerate={canModerate}
              onReply={(id) => {
                setReplyTo(id);
                setBody("");
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
