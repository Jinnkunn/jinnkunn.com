# Document repository

`@jinnkunn/document-repository` defines the storage boundary shared by the Web
app, Site Admin, Workspace, and remote clients. Implementations may use the
filesystem, D1, or the Site Admin API, but callers use the same contract.

## Path vocabulary

Repository paths are relative to the `content/` root and always use `/` as the
separator. For example, the repository path for `content/pages/bio.mdx` is
`pages/bio.mdx`. Absolute paths and parent traversal are rejected.

## Version semantics

- Every stored document has an opaque `version`.
- Updates and deletes supply the version they read as `expectedVersion`.
- Creates supply `expectedVersion: null`.
- A mismatch raises `DocumentConflictError`; callers must reload instead of
  overwriting a newer document.
- History and revision reads are optional capabilities. Implementations that do
  not support them raise `DocumentOperationUnsupportedError`.

The compatibility `ContentStore` and Site Admin file backend are adapters over
this interface. New storage behavior belongs here rather than in those legacy
facades.
