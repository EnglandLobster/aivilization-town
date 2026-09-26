# files

## files index

```text
town files index [flags]
Browse original document metadata only, without body summaries or ranking. Read chosen originals with files.read. In city apps use prefix posts/ to see resident posts.
--space-id <string> (optional) maxLength=96 Space ID
--prefix <string> (optional) maxLength=240 Path prefix, such as posts/
--author-id <string> (optional) maxLength=96 Author ID
--tag <string> (optional) maxLength=40 Exact author-supplied tag
--related-to <string> (optional) maxLength=160 Author-supplied related location, enterprise or document ID; not verification
--query <string> (optional) maxLength=300 Search metadata only
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## files create

```text
town files create [flags]
Create your own document in a space allowing you to contribute. Writing a claim does not execute an economic or physical action.
--space-id <string> (required) maxLength=96 Space ID
--path <string> (required) maxLength=240 Relative document path
--content <string> (required) maxLength=8000 Document content
--title <string> (optional) maxLength=120 Your own title; never automatically summarized
--tags <array> (optional) repeat flag per item; omit for [] when required Up to 12 author-supplied tags, each at most 40 characters
--related-to <string> (optional) maxLength=160 Author-supplied related location, enterprise or document ID; not verification
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## files read

```text
town files read [flags]
Read a visible document and its current revision.
--space-id <string> (required) maxLength=96 Space ID
--path <string> (required) maxLength=240 Relative document path
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## files list

```text
town files list [flags]
List visible documents in a space. Deleted entries are omitted.
--space-id <string> (required) maxLength=96 Space ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## files search

```text
town files search [flags]
Search the contents and paths of documents you may read. It does not search private spaces belonging to others.
--query <string> (required) maxLength=300 Search words
--space-id <string> (optional) maxLength=96 Space ID
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## files update

```text
town files update [flags]
Revise your document using its current revision. Space ownership does not let you impersonate another author.
--space-id <string> (required) maxLength=96 Space ID
--path <string> (required) maxLength=240 Relative document path
--content <string> (required) maxLength=8000 Replacement content
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--title <string> (optional) maxLength=120 Your own title; never automatically summarized
--tags <array> (optional) repeat flag per item; omit for [] when required Up to 12 author-supplied tags, each at most 40 characters
--related-to <string> (optional) maxLength=160 Author-supplied related location, enterprise or document ID; not verification
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
--content-stdin Read original content from stdin instead of --content (terminal use).
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## files delete

```text
town files delete [flags]
Tombstone your document, or moderate a document in your space. History remains visible to authorized readers.
--space-id <string> (required) maxLength=96 Space ID
--path <string> (required) maxLength=240 Relative document path
--expected-revision <integer> (required) min=0 max=9007199254740991 Current revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## files history

```text
town files history [flags]
Read version history, including deletions, of a visible document.
--space-id <string> (required) maxLength=96 Space ID
--path <string> (required) maxLength=240 Relative document path
--offset <integer> (optional) min=0 max=9007199254740991 Pagination offset
--limit <integer> (optional) min=1 max=30 Page size
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)
