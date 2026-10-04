# v0.1 implementation contract

Working contract for the implementation. Credentials never return over IPC. The main agent owns the Rust session, HTTPS client, credential storage, cache and command integration.

## IPC

- `connect_gitlab({input:{url,token}})` -> Session
- `restore_session()` -> Session|null (validates saved credential with /user; errors are explicit)
- `disconnect_gitlab({sessionId})` -> void; invalidates session and deletes account data and credential
- `query_gitlab({input:{sessionId,requestId,mode,query}})` -> Snapshot|null, null only for cache miss
- `mutate_gitlab({input:{sessionId,requestId,action}})` -> void
- `clear_gitlab_cache({sessionId})` -> void
- `open_gitlab_url({sessionId,url})` -> void (Rust validates registered instance)
- `get_local_draft({sessionId,key})` -> {body,updatedAt}|null; `set_local_draft({sessionId,key,body})` -> void; `clear_local_drafts({sessionId})` -> void
- `get_pending_operation({sessionId,projectId,iid})` -> {id,action,startedAt}|null; `acknowledge_pending_operation({sessionId,projectId,iid,receiptId})` -> void
- `set_window_close_guard({unsafeToClose})` -> void; `close_app_window()` -> void. Listen to `app-close-blocked` before activating the guard; always flush pending local saves before explicit close.

All objects camelCase. IDs are decimal strings. Discussion IDs are opaque hex strings.

Fetched-cache removal preserves local drafts and pending operations. Explicit logout removes all private account data. Mutations persist a UUID receipt before writing, retain it on ambiguous outcomes, and refuse another write on that MR until exact-ID acknowledgement. Cancellation only preempts waiting/HTTP, never receipt finalization. BUSY refuses connection changes during mutation processing. Optional mutation `localDraftKey` links a flushed composer draft to atomic successful-write finalization; it is never used to delete a different account's draft.
Session={id,instanceUrl,user:{id,username,name},serverVersion:string|null}
Error={code,message,retryAfterMs?:number}; code includes AUTH_REQUIRED, FORBIDDEN, NOT_FOUND, NETWORK, TIMEOUT, RATE_LIMITED, INVALID_INPUT, STORAGE, UNSUPPORTED, TOO_LARGE, UNKNOWN_OUTCOME, CANCELLED.
Snapshot={data:QueryData,fetchedAt:number UNIX milliseconds,source:'cache'|'network',nextPage:number|null,completeness:'page'|'complete'|'truncated'}

## Query enum (`kind` discriminator)

projects: {kind:'projects',search:string,membership:boolean,includeArchived:boolean,page:number}
mrs: {kind:'mrs',search:string,state:'all'|'opened'|'closed'|'merged',projectId?:string,reviewerId?:string,authorId?:string,updatedAfter?:string,updatedBefore?:string,page:number}
mr: {kind:'mr',projectId,iid}
diffs: {kind:'diffs',projectId,iid,headSha:string,page:number}; revision-scoped cache, validate head before and after network retrieval
discussions/commits/drafts: {kind,projectId,iid,page:number}
commitDiff: {kind:'commitDiff',projectId,iid,sha:string,page:number}
file: {kind:'file',projectId,path:string,sha:string} -> {content:string} (bounded UTF8 text only)
approvals: {kind:'approvals',projectId,iid} -> {approved:boolean,approvedBy:User[]}

QueryData is Project[] | MergeRequest[] | MergeRequest | Diff[] | Discussion[] | Commit[] | Draft[] | {content:string} | Approvals
Project={id,name,pathWithNamespace,description:string,webUrl,archived:boolean}
MergeRequest={id,iid,projectId,title,description,state,webUrl,author:User,sourceBranch,targetBranch,updatedAt,headSha:string|null,diffRefs:{baseSha,startSha,headSha}|null}
Diff={oldPath,newPath,diff,newFile:boolean,deletedFile:boolean,renamedFile:boolean,tooLarge:boolean,collapsed:boolean}
Discussion={id,individualNote:boolean,notes:Note[]}
Note={id,body,author:User,createdAt,system:boolean,resolvable:boolean,resolved:boolean,position:Position|null}
Position={baseSha,startSha,headSha,oldPath,newPath,oldLine?:number,newLine?:number,positionType:'text'|'file'}
Commit={id,title,createdAt}
Draft={id,body,discussionId:string|null,position:Position|null}
User={id,username,name}

## Action enum (`kind` discriminator)

All actions contain projectId,iid. No automatic retries for writes. Check headSha against latest MR before line posts and approve.
- comment: {kind,body,thread:boolean,position?:Position}
- reply: {kind,discussionId,body}
- editNote: {kind,noteId,body}; Rust checks current author is active user
- deleteNote: {kind,noteId}; Rust checks current author is active user
- resolve: {kind,discussionId,resolved:boolean}
- saveDraft: {kind,body,discussionId?:string,position?:Position}
- editDraft: {kind,draftId,body}
- deleteDraft/publishDraft: {kind,draftId}; publish each selected draft separately, never bulk publish unseen web drafts
- approve: {kind,sha:string}; unapprove: {kind}

Unsupported server API => UNSUPPORTED/NOT_FOUND, no synthetic success. Mutations clear account read cache after successful HTTP response; UI refreshes visible resource. UNKNOWN_OUTCOME locks repeat submission until explicit verification.

## Ownership

- frontend worker: src/types/gitlab.ts, src/lib/gitlab.ts, src/features/**, App routing and behavior tests. Uses typed wrappers and current components/theme; no frontend HTTP. Keep #mock accessible and sample data isolated. Default opens working client, #foundation retains original foundation.
- API worker: src-tauri/src/gitlab_api.rs and dto.rs only. Exposes public `fetch(client:&reqwest::Client, api_base:&url::Url, query:&Query) -> Result<ApiResult,AppError>` and `mutate(client,api_base,action,user_id:&str) -> Result<(),AppError>`. Client already has private-token sensitive header, timeout, redirect policy; no tokens exposed here. `ApiResult={data:serde_json::Value,next_page:Option<u32>,truncated:bool}`. `dto.rs` owns Session/User/AppError/Query/Action/Position; derive Serde with camelCase fields and internally tagged enums kind (camelCase variant names).
- distribution worker: .github/**, scripts/release*.mjs, docs/distribution.md, src/lib/updater.ts, src/components/UpdatePanel.tsx. Dependencies and Rust plugin integration owned by main. Updater Rust custom commands `check_app_update` -> {configured:boolean,version:string|null,notes:string|null}; `install_app_update` -> void. Endpoint/public key supplied at build through generated Tauri config; no arbitrary frontend endpoint input.

## Acceptance

Fixture-driven tests for real IPC calls, cache-first state, safe failures, pagination, review write outcomes; Rust adapter HTTP fixtures. Real server compatibility remains unverified until user supplies instance and authenticates. GitHub distribution requires known owner/repository and approved visibility, authenticated CLI, signing key in external secure file/CI secret.
