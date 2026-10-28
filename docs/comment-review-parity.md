# Plan for GitLab comment and review operations

2026-09-30. The target is MR review on Self-Managed. "Mock" below means the implementation that operates on fictional data in memory. It is distinct from sending to GitLab or saving server drafts.

## Basic operations

| Operation | Mock behavior for now | Conditions for a real connection |
| --- | --- | --- |
| Plain comment / start a thread | Chosen at input. Plain comments show no resolve action | Distinguish Notes from Discussions |
| Reply | Added to the target thread. A reply to a plain comment becomes a thread | Keep the discussion ID |
| Comment on a line / file | Keeps the file, old/new side, line, SHA and comparison range | Rust builds the base/start/head SHA, old/new path and diff position |
| Edit / delete own comment | Edit the text, confirm deletion. Existing replies stay when the parent text is deleted | Check the server's permissions. Do not assume admin rights |
| Resolve / reopen | Per thread. An action that goes with a reply runs at publish | Check resolvable, permissions and the latest state |
| Comment now | Added in memory at once | Prevent duplicate sends when the result is unknown |
| Add to review | Added to the pending list. Does not change published counts or resolved state | Check Draft Notes support and how fetch and save failures are handled |
| Review and publish | Edit and delete pending text, an overview comment, optional approval | Track partial success of posting and approval separately |
| Discard review | After confirmation, deletes the selected MR's pending items | State what is deleted: server drafts and local drafts |
| Markdown | Rendering of emphasis, code, quotes, lists, tables and so on in the input field and in the body | GitLab-specific syntax and reference resolution follow the server's behavior |

Emoji reactions are implemented (on the MR itself and on each comment). Adding uses an emoji picker with search and categories (skin tones, custom emoji and flags are out of scope), and your own reactions are toggled on the existing chips. The REST Discussions API does not include them, so comment reactions are fetched with the GraphQL `MergeRequest.notes(filter: ONLY_COMMENTS)` field `awardEmoji`, up to the oldest comment of the discussions on screen, one request per 100 items. The MR itself uses REST award_emoji. GraphQL reactions have no ID, so deletion rereads your own reaction ID from the REST list. [Emoji reactions API](https://docs.gitlab.com/api/emoji_reactions/).

Text being typed is kept separate from pending comments already added to the review. Input is distinguished by MR, reply target, file, SHA, old/new side and line, and is not mixed when you move to another MR. The publish dialog does not send text that is still being typed and has not been added.

In review input, the shortcuts are Ctrl+Enter for "Add to review" and Ctrl+Shift+Enter for "Post now". The status and dialog state that nothing is sent over the network when the app is not connected.

## Remaining features and decisions at connection

These are additional items for reaching parity and are not counted as done in the basic mock.

- Attachment upload, image paste, user/group mention suggestions, and resolving GitLab reference links.
- Tracking outdated diff positions, and filtering system events.

With a real connection, multi-line selection (`position[line_range]`) and creating, showing and applying suggestions are implemented. Rust computes the line code in GitLab's format (`<SHA-1 of the file path>_<old line>_<new line>`) and, before sending, also checks that the range lies in the same hunk and ends on the commented line. Applying a suggestion uses `PUT /suggestions/:id/apply` (for several, `PUT /suggestions/batch_apply`) with the ID in `suggestions` of the REST notes, and sends once after confirming that the MR head SHA has not changed since it was shown. A comment without an ID is applied by opening it in GitLab.
- GitLab-specific Markdown and quick actions. Rendering in the input field stays within basic Markdown and never looks as if a command ran.
- Thread locking, and editing others' comments with admin rights. Availability is decided by the connected server's version, tier and permissions.

Request changes and re-requesting review are implemented. Neither has a matching REST API operation, so they use the GraphQL `mergeRequestRequestChanges` (added in GitLab 18.9) and `mergeRequestReviewerRereview`. Request changes is accepted only when the current user is a reviewer. If the connected server's schema lacks the mutation or returns `errors`, the app shows `UNSUPPORTED` as not applied, and a response whose result cannot be read is treated as an unknown result and stops resending. Before sending, it checks that the MR's `references.full` matches the Action's project path, and for a re-request that the target is still a reviewer.

The mock's short SHA and single path are a simplified model for display checks, not a request type that can be sent to the Discussions API as is. Whether the approve button publishes drafts automatically differs between GitLab versions, so approval and publishing stay separate until the server is checked.

Markdown does not insert raw HTML and does not turn executable URLs into links. The unconnected mock does not fetch image URLs automatically. Network handling, credentials and persistent caches for posted content follow the existing Rust boundary.

## References

- [Comments and threads](https://docs.gitlab.com/user/discussions/): plain comments, threads, diff comments, editing and so on.
- [Merge request reviews](https://docs.gitlab.com/user/project/merge_requests/reviews/): immediate comments, pending reviews, resolve/reopen with a reply, publish and discard.
- [Discussions API](https://docs.gitlab.com/api/discussions/): `line_range` of multi-line comments and the line code format.
- [Suggest changes](https://docs.gitlab.com/user/project/merge_requests/reviews/suggestions/) and [Suggestions API](https://docs.gitlab.com/api/suggestions/): the `suggestion:-N+M` syntax and the apply API. The API docs do not say how to get a suggestion ID; it comes from `suggestions` in the REST notes ([Note entity](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/api/entities/note.rb), present only on MR diff comments).
- [Discussions API](https://docs.gitlab.com/api/discussions/): threads, replies, line positions and SHAs.
- [Draft Notes API](https://docs.gitlab.com/api/draft_notes/): pending comments and the publish operation.
- [GraphQL API reference](https://docs.gitlab.com/api/graphql/reference/): `mergeRequestRequestChanges`, `mergeRequestReviewerRereview`.
