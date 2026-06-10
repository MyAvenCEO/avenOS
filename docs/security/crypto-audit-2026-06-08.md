# avenOS — End-to-End Cryptography Security Audit

_Date: 2026-06-08 · Branch: claude/jolly-taussig-f2dcdd · Method: 5 subsystem mappers → 9 crypto-dimension finders + completeness critic → 3-lens adversarial verification (cryptographer / exploit-path / FP-skeptic), keep ≥2-of-3._


**Scope:** aven-caps (capabilities + encryption), aven-db (sync), tauri-plugin-self (self-signing + vault), aven-p2p (transport). 115 agents · 33 candidates · **14 confirmed** · 19 refuted.


---

## Executive Synthesis

# Executive Synthesis — avenOS End-to-End Cryptography Audit

## 1. Overall Cryptographic Posture

avenOS is built on a fundamentally sound design: a biscuit-rooted capability model, a clean per-identity DEK envelope scheme (X25519-ECDH → HKDF-SHA256 → XChaCha20-Poly1305), hardware-rooted device identity in the Secure Enclave, and a well-conceived three-state (Allow/Deny/Pending) fail-closed sync gate. The primitive choices and key-derivation hygiene are correct, and recent hardening landed real fixes. However, the audit found a consistent and serious gap between *what the cryptography is designed to bind* and *what the live wire path actually verifies* — the integrity machinery exists in the code but is, in several critical places, not wired into the apply path. The result is that a malicious-but-curious relay (the explicit threat model) can tamper with several classes of unauthenticated wire data without breaking any signature the receiver checks, despite the system having the exact primitives to stop it.

## 2. Cross-Cutting Themes / Systemic Weaknesses

**Theme A — "Implemented but not wired": the integrity layer is dead code on the live path.** The single most damaging pattern. `EditSignature`/`verify_signed_batch` is fully built and unit-tested but never stamped outbound nor checked inbound; `verify_on_apply` computes the BLAKE3 row digest and then discards it (`_digest`). Only the owner-binding — which signs *just* `value_id‖owner` — is enforced. This one gap is the root enabler of findings #7, #26, #29, and #31: every byte of `data` (sealed cells, keyshare columns, issuer pubkey) and the delete fields travel essentially unauthenticated, because the one artifact that would bind them to an author is inert.

**Theme B — the reader is not authoritative over what it decrypts.** AEAD position-binding is built on the write path (`cell_seal_aad` correctly binds coordinates + version) but the read path trusts the AAD embedded in the relay-supplied envelope and never recomputes the expected AAD for the slot it is reading, nor enforces `dek_version` against the current epoch (findings #3, #28). The tag proves "some DEK-holder sealed this," not "this belongs here, now." This converts a relay's ability to *move* ciphertext into an ability to *forge a member's view* and to *roll back* to revoked versions — defeating the very rotation/revocation the crypto was designed to provide.

**Theme C — capability granularity collapses on inbound sync.** The outbound model distinguishes Write/Read/Replicate/Delete/RotateDek, but the inbound apply gate hardcodes `AccOp::Write` for every row including deletes (#6). The distinct `Delete` capability is enforced locally and then forgotten on the wire — a delegated writer, or a relay flipping unsigned `delete_kind` bytes (#7/#26), can destroy data network-wide.

**Theme D — one key, one oracle, many roles.** The device Ed25519 key signs biscuits, owner-bindings, edit-sigs, auth challenges, *and* does the X25519 ECDH. Domain separators protect the internal signers from each other — but the WebView-exposed bare `sign` IPC (#14/#10/#30) signs arbitrary bytes with that key and no domain tag, so the separators provide zero protection against it. A compromised renderer becomes a universal forging oracle for the entire trust layer.

**Theme E — trust roots and channels read from tamperable sources.** The genesis verification root is read from a relay-controlled `issuer_pubkey_b64` column with cleartext-passthrough downgrade and no pinning to the identity UUID (#31); the wss peer-auth has empty channel binding so a proxy inside the TLS boundary can relay credentials (#21). Trust anchors are not pinned to anything the relay can't rewrite.

## 3. Top 3 to Fix First

1. **Wire `EditSignature` into the live apply path** (stamp `sign_batch` outbound under `EDIT_SIG_META_KEY`; have `verify_on_apply` actually compare its computed digest via `authorize_signed_edit`). This is the highest-leverage fix: it single-handedly closes the unauthenticated-`data` channel that underlies #29, #31, and the in-flight halves of #7/#26, and it costs little because the machinery already exists and is tested. Until this lands, AEAD position-binding the read path doesn't check is the *only* integrity on cell/keyshare contents — and it doesn't check it.

2. **Make the reader authoritative over AAD and version** (#3/#28): pass the reader-recomputed `cell_seal_aad` into `open_text_cell_payload` and reject on mismatch; stop storing the AAD in the envelope; enforce the recovered `dek_version` against the current/allowed epoch instead of discarding `_ver`. This closes cell-relabeling and intra-identity rollback, and is what actually makes revocation/rotation hold on *reads*, not just writes.

3. **Remove (or domain-gate) the bare `sign` IPC and enforce `Delete` on inbound** — two cheap, independent fixes with outsized blast radius. Drop `allow-sign` from `self:default` or force a reserved domain prefix disjoint from every protocol domain (#14), converting WebView compromise from "forge anything" back to "forge nothing useful." Separately, derive the apply op from `row.delete_kind.is_some()` → `AccOp::Delete` (#6) so destructive deletes require the capability the local path already demands. Both are small diffs against large, confirmed exploit paths.

## 4. What Is Notably Done Well

- **The recent hardening is real and confirmed.** The audit verified that wrapper-bound keyshare AAD, the DEK-version downgrade defense, and low-order/all-zero key rejection landed correctly — these are exactly the right mitigations and they hold up under adversarial review. (#1 remains as a residual recommendation to add the explicit contributory/all-zero ECDH check belt-and-suspenders, but the broader posture here is solid.)
- **Primitive selection and KDF hygiene are correct throughout:** XChaCha20-Poly1305 with 24-byte OsRng nonces (collision-negligible), HKDF-SHA256 with disjoint network-scoped info strings, RFC-7748-correct Ed25519→X25519 conversion, and Zeroize-on-drop for DEKs and the cached root.
- **The version-based write-side revocation genuinely works** — revoked peers never receive the v+1 keyshare and authenticated-decrypt fails on new cells (proven by the crypto.rs test suite). The rotation design is sound; the gaps are in *read-side enforcement*, not the rotation itself.
- **The hardware-rooted identity and key-storage design is well-constructed:** non-extractable SE P-256 key with a `.biometryCurrentSet` ACL, root cached only in Rust as `Zeroizing<[u8;32]>` and never crossing IPC, atomic 0o600 writes, and a documented choke point forbidding identity cross-pollination while unlocked.
- **The architecture has the right bones.** The three-state Pending gate (defer, don't drop), the relay-proof inbound boundary concept, ciphertext-blind Replicate relays, and the separation of authorization (biscuit) from confidentiality (DEK distribution) are all sound design decisions. Critically, *most of the fixes are wiring, not redesign* — the primitives, the signatures, and the AAD construction already exist; they simply need to be enforced on the paths that currently trust the relay.

A consistent through-line: avenOS's cryptographic *design* is markedly stronger than its cryptographic *enforcement*. The confirmed High findings are overwhelmingly cases where a correct primitive is built and then bypassed on the live wire — which is good news for remediation, because closing them is largely a matter of connecting machinery that already exists rather than designing it.


---

## Confirmed Findings (full detail)

> Duplicates across dimensions: **#14 = #10 = #30** (bare `sign` IPC oracle); **#3 = #28** (cell AAD not validated on read); **#7 = #26** (delete state unauthenticated). They are kept verbatim below as separate verifier records.


### [High] #3 — Cell AEAD AAD is never validated against expected coordinates on read — relay can relocate a sealed envelope across (table, column, row) without detection

- **Dimension:** AEAD & SYMMETRIC ENCRYPTION  ·  **Verifier votes:** 3 confirm / 0 refute
- **Location:** `app/src-tauri/src/jazz/jazz_engine.rs:128, 342 (open_sealed_text_for_identity / map_sensitive_storage_cell); crypto.rs:193-229 (open_text_cell_payload)`

**What:** On the write path the cell AAD correctly binds identity_urn|table|column|row|dek_version|ty|msv (cell_seal_aad, crypto.rs:252-265, called at jazz_engine.rs:322). But on the READ path the AAD is taken verbatim from the stored envelope (open_text_cell_payload reads aad_b64 out of the 'v1.nonce.aad.ct' string at crypto.rs:200/207 and authenticates the ciphertext against THAT self-supplied AAD), and the reader NEVER recomputes the expected cell_seal_aad for the (table,column,row,version) it is actually decoding to compare it. Both call sites discard everything: open_sealed_text_for_identity binds `(opened, _)` (line 128) and map_sensitive_storage_cell binds `(opened, _ver)` (line 342). A grep confirms cell_seal_aad is invoked only at the seal site and in tests — there is no equality check anywhere on read. The AEAD tag therefore only proves 'some holder of this DEK authenticated this AAD'; it does not prove the envelope belongs in the slot it was read from. Because the cell envelope lives inside the row `data` blob and, on the live wire, the only signature covering it is the owner-binding which signs just value_id‖owner (ownership.rs:51-55) and the per-batch EditSignature is never wired into apply, a malicious relay/peer can copy a sealed envelope from one cell into another cell of the same identity and the reader will decrypt and surface it as the target cell's value.

**Attack:** A relay holding ciphertext-blind replicate rights wants to corrupt a member's view without a DEK. It copies the sealed envelope from row A's `secret_note` cell into row B's `secret_note` cell (same identity, same DEK version, so the same DEK opens it). The owner-binding on row B still verifies (it signs only value_id‖owner, not cell contents/coordinates), and the apply gate's EditSignature path is dead code, so the relabeled row is accepted. On read, open_text_cell_payload authenticates against the envelope's own AAD (which still says row A's coordinates) and the reader discards that AAD, returning row A's plaintext as row B's value. The same trick relocates a sensitive value across columns/tables, or rolls a cell back to a prior dek_version envelope the reader still caches (the recovered dek_version `_ver` is thrown away, so version-based revocation/rotation is not enforced for reads).

**Evidence:** open_text_cell_payload returns `(s, dek_ver_line)` after `decrypt(... aad: &aad_plain ...)` where aad_plain is decoded from the envelope (crypto.rs:206-228). Callers: `if let Ok((opened, _)) = open_text_cell_payload(dek.expose(), raw)` (jazz_engine.rs:128) and `if let Ok((opened, _ver)) = open_text_cell_payload(dek.expose(), raw)` (jazz_engine.rs:342). No call site reconstructs cell_seal_aad(urn,table,col,row,expected_version,ty) to compare.

**Fix:** Make the reader authoritative over the AAD: have open_text_cell_payload take the reader-recomputed expected AAD (cell_seal_aad of the slot being decoded) and pass THAT to the AEAD `decrypt` as `aad`, instead of trusting the AAD embedded in the envelope. Stop storing the AAD in the envelope entirely (it is reconstructible). Additionally enforce that the recovered dek_version equals the cell's expected current/known version rather than discarding `_ver`, so a relocated/rolled-back envelope fails authentication.


### [High] #6 — Inbound delete is gated only as Write — the distinct Delete capability is never enforced on synced rows

- **Dimension:** CAPABILITY AUTHORIZATION  ·  **Verifier votes:** 3 confirm / 0 refute
- **Location:** `libs/aven-db/src/sync_manager/inbox.rs:333-339`

**What:** The inbound apply gate hardcodes `crate::capability::AccOp::Write` for EVERY received row, including rows flagged as soft/hard delete. The app's resolver then maps the row's table to a required cap via `required_write_op_for_table` (biscuit_resolver.rs:173-179), which only ever returns Admit / RotateDek / Write — never AccOp::Delete. The dedicated AccOp::Delete capability (defined in caps.rs:32, given to owners via OWNER_RIGHTS, and enforced on the LOCAL outbound originate path at jazz/mod.rs:3636) is therefore never checked on inbound sync. A peer that holds Write but not Delete (e.g. a delegated writer with a granular `grant(did,"write",prefix)`) can push a delete-flagged row and have it accepted by the verify_on_apply gate, because the gate only ever asks 'may this author Write?'.

**Attack:** An admin grants peer P a row-scoped or table-scoped `write` capability on identity O's data (write but no delete). P crafts a StoredRowBatch for one of O's rows, sets metadata key Delete="hard" (parsed into delete_kind=Hard, types.rs:261-270/309-310), stamps a valid owner-binding (P is an authorized writer so verify_on_apply's authorize(Write) passes), and syncs it. Every receiving member's verify_on_apply runs authorize(..., AccOp::Write, ...) — which P satisfies — so the hard-delete is applied. resolution.rs:88-98/381-398 ranks Hard>Soft>live, so the row's data is cleared network-wide. P performed a destructive Delete it was never granted.

**Evidence:** inbox.rs:333-339 `resolver.verify_on_apply(&subject, crate::capability::AccOp::Write, &res, &digest.0, proof)` — literal AccOp::Write with no branch on row.delete_kind. biscuit_resolver.rs:157 `required_write_op_for_table(&res.table)` returns Admit/RotateDek/Write only (lines 173-179); no mapping to AccOp::Delete. AccOp::Delete exists (caps.rs:32) and is only enforced at the local originate gate jazz/mod.rs:3636.

**Fix:** In apply_row_updated, derive the op from the row: if `row.delete_kind.is_some()` pass `AccOp::Delete` (or have required_write_op_for_table return Delete for delete-flagged rows). Then a writer that lacks the delete right is denied at apply on every peer, matching the local originate gate.


### [High] #7 — delete_kind / is_deleted are not covered by content_digest, owner-binding, or edit-sig — a relay can flip or strip a delete without breaking any signature the apply gate verifies

- **Dimension:** CAPABILITY AUTHORIZATION  ·  **Verifier votes:** 3 confirm / 0 refute
- **Location:** `libs/aven-db/src/row_histories/codecs.rs:35-74`

**What:** compute_row_digest hashes only `row-batch-v1 | branch | parents | data | updated_at | updated_by | metadata`. The Delete metadata key is stripped out of `metadata` and lifted into the standalone struct fields `delete_kind`/`is_deleted` (types.rs:309-316) BEFORE the digest is computed, and content_digest (types.rs:351-360) hashes the post-strip metadata, so neither field is in the digest. The owner-binding signs only `value_id || owner` (ownership.rs:51-56) and the edit-signature signs the receiver-computed digest (ownership.rs:146-155). delete_kind/is_deleted are #[derive(Serialize/Deserialize)] struct fields on StoredRowBatch (types.rs:208-224) that travel the wire verbatim. Consequently a malicious relay/peer can mutate delete_kind on a row in flight (add a Hard delete, downgrade Hard→Soft, or strip a delete) and the row's digest, owner-binding, and edit-sig all still verify — the apply gate has nothing that detects the tamper.

**Attack:** Honest-but-curious relay forwards O's live row R. It flips delete_kind from None to Hard (or sets is_deleted, clears nothing else). The owner-binding (value_id||owner) is untouched and still verifies; the recomputed content_digest is unchanged because delete_kind isn't hashed; verify_on_apply Allows. resolution.rs ranks the tampered Hard version as the winner, wiping R's data for every member — a relay-driven destructive action with no key material. Conversely the relay can strip an owner's legitimate delete, resurrecting data the owner intended to remove.

**Evidence:** codecs.rs:45-71 hashes branch/parents/data/updated_at/updated_by/metadata only. types.rs:311-316 filters MetadataKey::Delete out of metadata into delete_kind/is_deleted struct fields; types.rs:351-360 content_digest hashes the stripped metadata. ownership.rs:51-56 owner_binding_msg = DOMAIN||value_id||owner (no delete). resolution.rs:88-98 ranks Hard(2)>Soft(1)>live.

**Fix:** Include delete_kind and is_deleted in compute_row_digest (e.g. a 1-byte tag for None/Soft/Hard after updated_by), so the edit-signature and any digest-based integrity check cover the delete state. Since the edit-sig is the artifact that binds authorship to the digest, this makes a delete a signed authorial act rather than relay-mutable plaintext.


### [High] #14 — `sign` IPC is an unrestricted signing oracle over the device identity key (confused-deputy / auth-challenge forgery)

- **Dimension:** KEY STORAGE AT REST & IN MEMORY (key material crossing the Tauri IPC boundary)  ·  **Verifier votes:** 2 confirm / 1 refute
- **Location:** `libs/tauri-plugin-self/src/commands.rs:51-54`

**What:** The `sign` Tauri command signs ANY caller-supplied byte vector with the device identity Ed25519 key (state.with_root -> derive::sign(root, &message), derive.rs:44-46) and applies NO domain-separation tag or context binding. That exact key — `tauri_plugin_self::derive::signing_key_from_root(root)` — is the single key reused for the p2p peer-auth challenge response, biscuit issuance, owner-binding, and edit-sig (confirmed at app/src-tauri/src/jazz_auth.rs:25-27 and jazz_engine.rs:559). The peer-auth challenge is signed over the raw UTF-8 of `build_message(...)` with no binary domain prefix (libs/aven-p2p/src/challenge.rs:118-120), so a signature produced by `sign` over that exact string is a valid ClientAuth. The command is granted to the main WebView with no per-call scoping via `allow-sign` in the default permission set (libs/tauri-plugin-self/permissions/default.toml:14, wired into app/src-tauri/capabilities/default.json `self:default`).

**Attack:** A compromised WebView context (malicious renderer-loaded JS, XSS in a rendered note, or a hostile sandboxed module that can reach the IPC bridge) constructs the SIWE-style challenge string with the server's nonce/domain/uri and invokes `plugin:self|sign` with those bytes. It receives a 64-byte Ed25519 signature over the challenge and replays it as a ClientAuth, authenticating to the relay/server AS the device, without ever touching the SE/biometric unlock again (the root is already cached). The same oracle can mint signatures the aven-caps layer would otherwise trust, because nothing structurally separates 'sign this app message' from 'sign this protocol attestation' at the key.

**Evidence:** commands.rs:52-54: `pub async fn sign(state: State<'_, SelfState>, message: Vec<u8>) -> Result<Vec<u8>, String> { state.with_root(|root| Ok(derive::sign(root, &message)?.to_vec())) }`. derive.rs:44-46 signs `message` directly with no prefix. challenge.rs:118-120 signs `message.as_bytes()` of a plain `format!` string (no `\0` domain). default.toml:14 grants `allow-sign`.

**Fix:** Remove the generic `sign` command from the WebView-reachable surface, or gate it behind a mandatory domain-separation prefix that is disjoint from every protocol domain (challenge, owner-binding `avenos:owner-binding:v1\0`, edit-sig, biscuit). Best: make `sign` accept only a typed purpose enum and internally prepend a per-purpose domain tag, and require the challenge/owner-binding/edit-sig signers to use binary domain prefixes the WebView path can never produce. At minimum, drop `allow-sign` from `self:default` so the IPC is not exposed to the main window.


### [High] #26 — Delete state (delete_kind / is_deleted) is unauthenticated on the wire — a relay or Write-only peer can forge a hard-delete that erases a victim's row

- **Dimension:** SYNC DATA EXPOSURE  ·  **Verifier votes:** 3 confirm / 0 refute
- **Location:** `libs/aven-db/src/row_histories/codecs.rs:35-74 (compute_row_digest); types.rs:351-360 (content_digest); types.rs:220-221 (wire fields); inbox.rs:326-339 (apply gate)`

**What:** StoredRowBatch carries `delete_kind: Option<DeleteKind>` and `is_deleted: bool` as serde-serialized wire fields (types.rs:220-221), and the inbound SyncPayload::RowBatchCreated/RowBatchNeeded payload deserializes a StoredRowBatch directly from the peer (sync_manager/types.rs:211-219). These fields are persisted verbatim by the apply path (apply_row_batch_with_context → encode_history_row_bytes_with_context at mutations.rs:288 → codecs.rs:159-162). However, the content_digest that the apply gate verifies (computed at inbox.rs:326 via StoredRowBatch::content_digest, types.rs:351-360 → compute_row_digest, codecs.rs:35-74) hashes ONLY branch | parents | data | updated_at | updated_by | metadata. delete_kind/is_deleted are NOT hashed, AND delete_kind is explicitly stripped out of `metadata` during construction (types.rs:311-316 filters out MetadataKey::Delete). The owner-binding proof checked at verify_on_apply (biscuit_resolver.rs:121-126) signs only value_id+owner (ownership.rs:51-57), and the receiver-computed digest passed to verify_on_apply is ignored entirely (`_digest`, biscuit_resolver.rs:97). Therefore the delete fields are covered by no signature and no digest anywhere on the inbound path. In resolution, a row with delete_kind=Some(Hard) wins (delete_winner, resolution.rs:82-104) and the merged visible row's data is cleared to Vec::new() (resolution.rs:381-382).

**Attack:** A malicious relay (Replicate cap, holds ciphertext + plaintext metadata) or a member peer that holds only Write on the identity captures a victim's legitimately-signed StoredRowBatch, flips delete_kind from None to Some(Hard) and is_deleted to true (leaving branch/parents/data/updated_at/updated_by/metadata byte-identical), and re-injects it via RowBatchCreated. The content_digest is unchanged, so any owner-binding/edit-sig stays valid; verify_on_apply re-verifies the (still-valid) owner-binding and passes. The forged Hard-delete is persisted, wins delete resolution, and clears the row's data on every downstream member — destroying data the attacker was never authorized to delete, with no signature broken. Stripping an existing delete (Some→None) works the same way to resurrect deleted rows.

**Evidence:** codecs.rs:45-71 — compute_row_digest updates b"row-batch-v1", branch, parents, data, updated_at, updated_by, metadata; no delete_kind/is_deleted. types.rs:351-360 — content_digest passes exactly those fields. types.rs:311-316 — `.filter(|(key, _)| key != MetadataKey::Delete.as_str())` strips the delete key from metadata before hashing. biscuit_resolver.rs:97 — `_digest: &[u8; 32]` is unused. ownership.rs:51-57 — owner_binding_msg = DOMAIN || value_id || owner only.

**Fix:** Bind delete state cryptographically on apply. Two complementary fixes: (1) Include delete_kind and is_deleted in compute_row_digest (codecs.rs:35-74) so any flip changes the digest — and have verify_on_apply actually compare its computed digest against a signed value (wire the EditSignature that already exists at ownership.rs:118-155 into the proof, rather than ignoring `_digest`). (2) On the inbound apply path, when a row asserts delete_kind.is_some(), call the resolver with AccOp::Delete (not the hardcoded AccOp::Write at inbox.rs:335) so a peer lacking the Delete cap is rejected. Both are needed: (1) stops tamper-in-flight by a relay; (2) stops an authenticated Write-only peer from self-authoring deletes.


### [High] #28 — Sealed-cell AAD is never re-checked against the cell's true coordinates on read — relay can relabel/move ciphertext between cells of the same identity

- **Dimension:** aead-encryption  ·  **Verifier votes:** 3 confirm / 0 refute
- **Location:** `app/src-tauri/src/jazz/jazz_engine.rs:326-350 (map_sensitive_storage_cell) and 110-133 (open_sealed_text_for_identity); seal-side AAD built only at 306-324`

**What:** On the WRITE path, seal_column_plain (jazz_engine.rs:322) binds every cell to its position with cell_seal_aad(urn|table|column|row|dek_version|ty|msv). But on EVERY READ path the AAD that the AEAD authenticates is the one carried INSIDE the relay-supplied envelope (crypto.rs:200,207), and no caller ever reconstructs the expected cell_seal_aad from the cell's true (table,column,row,identity,version) and compares it. map_sensitive_storage_cell trial-decrypts and discards the returned version (`_ver`, line 342); open_sealed_text_for_identity discards it entirely (line 128). A grep confirms cell_seal_aad is constructed only at the single seal site (line 322) and nowhere on read. Because all cells of a given identity+dek_version share ONE DEK, the AEAD tag only proves the (DEK, embedded-AAD, ciphertext) triple is self-consistent — it does NOT prove the embedded AAD matches the storage location the relay placed the envelope in. The position binding the AAD was designed to provide is therefore unenforced.

**Attack:** A malicious/curious relay holding ciphertext (it has no DEK) copies the sealed envelope of cell A (e.g. identities.issuer_pubkey_b64, or messages.body, same identity, same dek_version) into the storage column of cell B (e.g. a different row/column). The owner-binding still verifies (it signs only value_id+owner, not the data), and the inbound apply gate never checks the digest, so the tampered row is accepted. When a legitimate member next reads cell B, open_text_cell_payload decrypts with the shared DEK against the embedded AAD-of-A, authenticates successfully, and the UI displays A's plaintext in B's place. This is a confused-deputy cell-relabeling: AEAD was supposed to prevent exactly this, but the missing caller-side AAD comparison defeats it. It also enables intra-identity rollback (replay an old envelope for the same coordinate) since the version in the AAD is parsed but never enforced against identities.current_dek_version.

**Evidence:** Read path: `if let Ok((opened, _ver)) = open_text_cell_payload(dek.expose(), raw)` (jazz_engine.rs:342) — _ver and the embedded AAD are discarded. open_text_cell_payload returns `(s, dek_ver_line)` (crypto.rs:228) but the AAD itself (`aad_plain`) is consumed only by the AEAD, never returned for comparison. Seal path: `let aad = cell_seal_aad(&urn, table, col_name, row, v, slug);` (jazz_engine.rs:322) is the ONLY construction of the expected AAD in the whole app crate.

**Fix:** On open, reconstruct the expected AAD from the cell's authoritative coordinates (identity_urn, table, column, row, expected dek_version, storage-type slug) and require byte-equality with the AAD recovered from the envelope BEFORE trusting the plaintext — i.e. pass the expected AAD into open_text_cell_payload and reject on mismatch instead of trial-decrypting and ignoring it. Additionally enforce that the opened dek_version equals identities.current_dek_version (or an explicitly allowed historical version for that coordinate) to close the rollback variant.


### [High] #29 — Inbound apply gate discards the receiver-computed row digest — sealed cell data and keyshare payload columns are unauthenticated on the live wire

- **Dimension:** sync-authz-exposure  ·  **Verifier votes:** 3 confirm / 0 refute
- **Location:** `app/src-tauri/src/biscuit_resolver.rs:92-165 (verify_on_apply ignores _digest); inbox.rs:326-338 computes and passes it`

**What:** inbox.rs carefully computes the BLAKE3 row digest (`let digest = row.content_digest();`, inbox.rs:326) which covers branch|parents|data|updated_at|updated_by|metadata (codecs.rs:35-74), and passes it to verify_on_apply. But the production resolver verify_on_apply names the parameter `_digest` (biscuit_resolver.rs:97) and never uses it. The only proof consumed is the OwnerBinding, whose signed message is `domain || value_id || owner` (ownership.rs:51-56) — it does NOT cover `data` or `metadata` at all. The EditSignature, which is the only artifact that signs the digest (ownership.rs:146-155), is never stamped or passed (confirmed: inbox.rs:329 extracts only OWNER_BINDING_META_KEY). Net effect: the entire `data` blob — every sealed cell ciphertext AND the keyshares-table columns wrapper_did/recipient_did/wrapped_dek/dek_version — is accepted with no signature binding it to an authorized author.

**Attack:** A malicious relay rewrites the `data` of an in-flight keyshares row: e.g. substitutes a wrapped_dek/wrapper_did it captured from a different (member,version) pair, or strips/downgrades a sealed cell. The owner-binding still verifies (value_id+owner unchanged), the binding.owner matches the established ACL owner, and the per-kind cap (RotateDek/Write) is satisfied by the legitimate author named in the binding, so verify_on_apply returns Allow. The receiver persists attacker-chosen ciphertext/metadata. Combined with the read-side AAD-non-verification above, this is the delivery mechanism for cell-relabeling and keyshare-confusion attacks; it also lets a relay flip the (unsigned) keyshare metadata columns the hydrate path trusts (wrapper_did → DH counterparty selection, jazz_engine.rs:632).

**Evidence:** Signature: `fn verify_on_apply(&self, _subject: &SyncTargetId, _op: AccOp, res: &ResourceCoord, _digest: &[u8; 32], proof: Option<&[u8]>)` (biscuit_resolver.rs:92-99) — `_digest` prefixed unused. Owner-binding message: `m.extend_from_slice(value_id.as_bytes()); m.extend_from_slice(owner.as_bytes());` (ownership.rs:54-55) — data/metadata absent. inbox.rs proof extraction: `.get(crate::capability::OWNER_BINDING_META_KEY)` only (inbox.rs:331).

**Fix:** Wire EditSignature into the live path: stamp sign_batch over the receiver-aligned digest on outbound rows under EDIT_SIG_META_KEY, and in verify_on_apply require verify_signed_batch(edit_sig, _digest) (i.e. call authorize_signed_edit, which already exists and is tested) so the digest covering `data`+`metadata` is cryptographically bound to an authorized author. Until then, treat all cell/keyshare contents as relay-tamperable and do not rely on AEAD position binding the read path doesn't check.


### [High] #31 — Hydrate opens genesis_b64 / issuer_pubkey_b64 as cells but passes them straight into the biscuit trust root with no AAD/coordinate or plaintext-downgrade check

- **Dimension:** capability-authz  ·  **Verifier votes:** 2 confirm / 1 refute
- **Location:** `app/src-tauri/src/jazz/jazz_engine.rs:110-133 (open_sealed_text_for_identity), 663-692 (hydrate ingest)`

**What:** During hydration the genesis biscuit and its verification root issuer_pubkey_b64 are recovered via open_sealed_text_for_identity (jazz_engine.rs:663,674) and fed to ingest_genesis_opened, which uses the recovered issuer pubkey as the Biscuit::from verification ROOT (caps.rs:533,536,569). open_sealed_text_for_identity has two trust gaps: (1) at lines 115-116 any value NOT starting with 'v1' is returned verbatim as cleartext — a relay can strip the envelope so genesis/issuer are read as unauthenticated plaintext (downgrade); (2) for 'v1' values it trial-decrypts across all DEK versions and never checks the recovered AAD names this identity's identities.genesis_b64/issuer_pubkey_b64 coordinate, so a same-identity cross-cell swap (per the AAD finding) reaches the biscuit root selection. Crucially the issuer pubkey is never pinned to the deterministic identity UUID, so whatever pubkey survives this opening becomes the root the genesis chain is verified against.

**Attack:** A relay that controls the identities row sets issuer_pubkey_b64 and genesis_b64 to a chain rooted in the attacker's own key (or strips the envelope to plant plaintext). open_sealed_text_for_identity returns the attacker bytes (cleartext passthrough at line 116, or via cross-cell AAD confusion), ingest_genesis_opened decodes the attacker pubkey and biscuit_from_storage validates the attacker chain against the attacker root (caps.rs:533-536) — verification 'passes'. The vault now holds an identity biscuit whose owners/admins are attacker-chosen, escalating authorize() decisions. The only backstop is the apply-gate having rejected the tampered identities row earlier, but per the digest-discard finding the identities `data` is not signature-bound on the wire.

**Evidence:** `if !raw.starts_with(CELL_ENVELOPE_V1) { return Ok(raw.to_string()); }` (jazz_engine.rs:115-116). Issuer selection: `Some(s) if !s.trim().is_empty() => decode_issuer_pubkey_b64(s)?` then `biscuit_from_storage(genesis_b64, issuer_pk)` (caps.rs:533,536) — the root is whatever bytes were opened, with no binding to `owner: Uuid`.

**Fix:** Pin the issuer/root: derive or verify the genesis root against the deterministic identity UUID (e.g. require issuer_pubkey to match a value committed by a higher-trust authority, not a self-describing row column). Reject non-'v1' genesis/issuer cells instead of cleartext passthrough, and verify the recovered cell AAD names exactly (identity, 'identities', 'genesis_b64'/'issuer_pubkey_b64', row) before trusting the bytes as a trust root.


### [Medium] #1 — No low-order / all-zero shared-secret check after X25519 ECDH — KEK can be forced to a known value

- **Dimension:** KEY DERIVATION & SEPARATION  ·  **Verifier votes:** 2 confirm / 1 refute
- **Location:** `libs/aven-caps/src/crypto.rs:79-80`

**What:** derive_kek_x25519 performs a static-static X25519 diffie_hellman and feeds the raw output directly into hkdf_kek with no contributory-behaviour / all-zero / low-order point check. x25519-dalek's StaticSecret::diffie_hellman does NOT return an error or flag when the peer public point is of small order: it returns the (possibly all-zero) shared secret silently. The peer Ed25519 public key is converted to Montgomery form via ed25519_pk_to_curve25519_pk (line 59-63), which decompresses ANY valid Edwards point and calls to_montgomery() — small-order Edwards points (and the points whose Montgomery image is one of the known low-order u-coordinates) decompress fine. A malicious peer that is named as the DH counterparty can therefore present a crafted Ed25519 public key whose Montgomery image is low-order, forcing the ECDH output (and hence the HKDF-derived KEK) to a value the attacker can predict (e.g. the all-zero shared secret).

**Attack:** Under the threat model's 'malicious PEER that holds a valid identity', a peer registers/advertises an Ed25519 public key that decompresses to a low-order Montgomery point. When this device wraps a DEK to that peer via derive_kek_x25519(my_ed_sk, attacker_pk) -> hkdf_kek, the ECDH output is a fixed low-order value (e.g. all zeros) independent of my secret. The KEK = HKDF-SHA256(empty-salt, all-zero, KEYSHARE_INFO) is then a constant the attacker can compute offline. Combined with the relay-tamperable wrapper_did selection in the hydrate path, this gives an attacker a predictable KEK to either forge or trivially unwrap a keyshare without performing real ECDH, breaking the confidentiality the keyshare envelope is supposed to provide.

**Evidence:** crypto.rs:79-80: `let shared = my_x25519.diffie_hellman(&XPub::from(peer_montgomery)); Ok(hkdf_kek(shared.as_bytes()))` — the result of diffie_hellman is passed straight to hkdf with no check that `shared.as_bytes()` is non-zero / that peer_montgomery is not low-order. crypto.rs:59-63: ed25519_pk_to_curve25519_pk decompresses any peer key and to_montgomery() with no torsion/order filtering.

**Fix:** After the diffie_hellman call, reject the all-zero shared secret (constant-time compare against [0u8;32]) before deriving the KEK, and/or validate the Montgomery u-coordinate is not one of the known low-order values. Prefer using x25519-dalek's `diffie_hellman` with the `was_contributory()` check (available on SharedSecret) and return Err on a non-contributory exchange. At minimum: `if shared.as_bytes().ct_eq(&[0u8;32]).into() { return Err("low_order_dh".into()); }`.


### [Medium] #10 — Bare `sign` IPC is a universal Ed25519 signing oracle with no domain separation — forges owner-bindings, edit-sigs, and peer-auth challenge responses

- **Dimension:** IDENTITY & SIGNING  ·  **Verifier votes:** 2 confirm / 0 refute
- **Location:** `libs/tauri-plugin-self/src/commands.rs:51-54`

**What:** The `sign` Tauri command (commands.rs:51-54 → derive::sign at derive.rs:44-47) signs ARBITRARY caller-supplied bytes with the device identity Ed25519 key and applies NO domain-separation tag or context prefix. It is exposed to the main webview via the `self:default` capability (default.toml lists `allow-sign`; app/src-tauri/capabilities/default.json grants `self:default` to window `main`). Meanwhile every other consumer of this exact same key carefully prepends a domain tag: owner-bindings use `avenos:owner-binding:v1\0` (ownership.rs:37,52-56), edit-signatures use `avenos:edit-sig:v1\0` (ownership.rs:38,128-134), and the peer-auth challenge signs a deterministic, attacker-reconstructable message string (challenge.rs:118-119, build_message at challenge.rs:95-115). Because `sign` signs raw bytes, the carefully-chosen domain separators provide ZERO protection against it: a caller simply supplies the full `avenos:owner-binding:v1\0 || value_id || owner` byte string (or the challenge message text, or `avenos:edit-sig:v1\0 || digest || did`) and receives a signature that verify_owner_binding (ownership.rs:75-81), verify_signed_batch (ownership.rs:146-154), and challenge::verify (challenge.rs:124-136) all accept as authentic.

**Attack:** A compromised or malicious WebView (XSS in the local UI, a poisoned QuickJS sandbox escape, or any IPC-capable code) invokes `plugin:self|sign` with the bytes `b"avenos:owner-binding:v1\0" || target_value_id || victim_identity_uuid`. The returned 64-byte signature, packaged into an OwnerBinding{value_id, owner, author_did=self, sig}, passes verify_owner_binding on every relay and member — the attacker has forged authorship/ownership of a value under another identity's namespace. The same oracle yields a valid peer-auth challenge response (sign the build_message string) to authenticate the device to any relay on demand, and a valid EditSignature once that machinery is wired. No biometric prompt is required because `sign` reads the already-cached root (state.with_root).

**Evidence:** commands.rs:52 `pub async fn sign(state: State<'_, SelfState>, message: Vec<u8>) -> Result<Vec<u8>, String> { state.with_root(|root| Ok(derive::sign(root, &message)?.to_vec())) }`; derive.rs:44-46 `pub fn sign(root: &[u8; 32], message: &[u8]) -> Result<[u8; 64], String> { let sk = signing_key_from_root(root)?; Ok(ed25519_dalek::Signer::sign(&sk, message).to_bytes()) }` — no prefix. Contrast ownership.rs:37 `const OWNER_BINDING_DOMAIN: &[u8] = b"avenos:owner-binding:v1\0";` which is defeated because `sign` will sign exactly those bytes if asked.

**Fix:** Do not expose a raw-bytes signing oracle to the webview. Either (a) remove the generic `sign`/`verify` IPC commands entirely and replace with purpose-specific commands that internally prepend a fixed, command-bound domain tag the webview cannot influence (e.g. `sign_auth_challenge(hello)` that reconstructs and tags the message server-side), or (b) have `derive::sign` unconditionally prepend a reserved domain prefix (e.g. `avenos:webview-sign:v1\0`) that is DISJOINT from every internal signing domain, so a webview signature can never be replayed as an owner-binding, edit-sig, or challenge response. Also scope `allow-sign` out of the default capability if no first-party UI needs it.


### [Medium] #21 — wss peer-auth has zero channel binding, so a malicious proxy inside the TLS boundary can relay the client's challenge response to the backend (credential relay / impersonation)

- **Dimension:** TRANSPORT & PEER-AUTH PROTOCOL  ·  **Verifier votes:** 2 confirm / 0 refute
- **Location:** `libs/aven-p2p/src/ws_client.rs:38, 83 (client); libs/aven-node/src/ws_server.rs:30, 140 (server)`

**What:** On the wss transport, TLS terminates at the Sprites proxy (ws_client.rs:7-11 documents this explicitly), so the proxy is INSIDE the TLS trust boundary and sees the cleartext WebSocket handshake. The challenge folds in NO channel binding: NO_CHANNEL_BINDING = "" on both ends (ws_client.rs:38, ws_server.rs:30), and build_message is called with that empty string (ws_client.rs:83, ws_server.rs:140). The signed message therefore binds only (domain, uri, network, did, nonce, issued, exp) — nothing that ties the signature to the specific transport connection it traveled on. A malicious or compromised proxy/on-path relay can open its own backend connection, read the backend's ServerHello (with the backend's fresh nonce), forward that exact ServerHello verbatim to the victim client, receive the client's ClientAuth, and replay it on the backend connection. The backend's verify_client (ws_server.rs:135-143) verifies the signature against the same nonce it issued and the empty channel binding, so it accepts the relayed proof and stamps Source::Client(victim) (ws_server.rs:107) — the relay is now authenticated to the backend AS the victim, anchoring the downstream biscuit may_sync gate to the victim's identity. The raw-TLS path defends against this with a real TLS-exporter channel binding (transport.rs:114-120, 262-268); the wss path has no equivalent.

**Attack:** A compromised Sprites proxy (or an attacker who has MITM'd the wss link before the proxy) accepts the victim device's WebSocket, simultaneously dials the real aven-node backend, forwards the backend's ServerHello to the victim, captures the victim's ClientAuth, and presents it to the backend. The backend authenticates the proxy's connection as the victim peer. The proxy can now push sync frames to the backend stamped as the victim's PeerId, which is the authorization anchor for may_sync — bypassing per-peer outbound/inbound capability scoping for any resource the victim can reach.

**Evidence:** ws_client.rs:38 `const NO_CHANNEL_BINDING: &str = "";` and ws_client.rs:83 `let message = build_message(&hello, &did, NO_CHANNEL_BINDING);`. ws_server.rs:30 `const NO_CHANNEL_BINDING: &str = "";` and ws_server.rs:140 `let message = build_message(hello, &auth.did, NO_CHANNEL_BINDING);`. ws_client.rs:7-11 doc: "the challenge cannot bind to the TLS session — the device's TLS ends at the proxy. Replay is instead prevented by the server's single-use, TTL nonce" — but the nonce alone does not prevent live relay because the relay forwards the backend's own nonce to the client.

**Fix:** Bind the wss challenge to something the proxy cannot transparently forward. Options: (1) Have the client include a fresh client-chosen nonce AND the server's nonce in the signed message, and have the server additionally sign the AuthResult so the client can detect a substituted backend (mutual binding). (2) Re-introduce a channel binding derived from the end-to-end TLS to the actual backend (e.g. terminate TLS at the aven-node, or use TLS-exporter passed through the proxy via a trusted header). (3) At minimum, treat the wss path as un-relay-resistant and require an application-layer mutual handshake (client nonce + server signature over (client_nonce||server_nonce||client_did)) so a relay cannot complete both sides. Do not rely on the TTL nonce as anti-relay — it only stops delayed replay, not live forwarding.


### [Medium] #30 — Bare `sign` IPC command lets a compromised WebView forge owner-bindings / edit-sigs / auth challenges with the identity key (no domain restriction)

- **Dimension:** identity-signing  ·  **Verifier votes:** 3 confirm / 0 refute
- **Location:** `libs/tauri-plugin-self/src/commands.rs:51-54`

**What:** The `sign` Tauri command signs arbitrary caller-supplied bytes with the device identity Ed25519 key: `state.with_root(|root| Ok(derive::sign(root, &message)?.to_vec()))` (commands.rs:52-53), with no domain-separation tag, no context binding, and no per-call authorization. The SAME identity key is the sole signer of the security-critical messages in aven-caps and aven-p2p: owner-bindings (`avenos:owner-binding:v1\0` || value_id || owner, ownership.rs:51-56), edit-signatures (`avenos:edit-sig:v1\0` || digest || did, ownership.rs:128-133), and the SIWE-style peer-auth challenge (challenge.rs:95-121). Those subsystems rely on the key never signing attacker-chosen bytes; the plugin command breaks that assumption.

**Attack:** A compromised WebView (XSS / malicious dependency) or any IPC caller in the allowlist constructs the exact 24+16+16 byte owner-binding message for ANY (value_id, owner) it likes and calls invoke('sign', {message}). The returned 64-byte signature is a fully valid OwnerBinding (verify_owner_binding passes — it is a genuine signature by the device key, ownership.rs:75-81), letting the attacker mint authentic ownership bindings for arbitrary values/identities without going through the in-process caps gate. The same primitive forges a challenge response (peer-auth, challenge.rs) and, once EditSignature is wired, forges per-batch authorship. This is a confused-deputy that converts WebView compromise into capability-layer signature forgery.

**Evidence:** `pub async fn sign(state: State<'_, SelfState>, message: Vec<u8>) -> Result<Vec<u8>, String> { state.with_root(|root| Ok(derive::sign(root, &message)?.to_vec())) }` (commands.rs:51-53). The caps signers all use the same key with only a prefix as separation, e.g. `m.extend_from_slice(OWNER_BINDING_DOMAIN); m.extend_from_slice(value_id.as_bytes()); m.extend_from_slice(owner.as_bytes());` (ownership.rs:53-55) — a prefix the bare sign command will happily replicate.

**Fix:** Remove the general-purpose `sign` IPC command, or restrict it to a fixed safe domain prefix that is provably disjoint from every internal signing domain (owner-binding, edit-sig, challenge), and refuse to sign messages whose first bytes match any reserved `avenos:` / SIWE challenge prefix. Better: never expose raw identity-key signing to the WebView at all; perform owner-binding/edit-sig/challenge signing only in trusted Rust with structured (non-attacker-shaped) inputs.


### [Low] #17 — Dev-insecure device root stored as unauthenticated plaintext with no integrity/MAC — silent identity substitution on tamper

- **Dimension:** KEY STORAGE AT REST & IN MEMORY (encryption at rest / integrity of stored key)  ·  **Verifier votes:** 2 confirm / 1 refute
- **Location:** `libs/tauri-plugin-self/src/dev_insecure.rs:84-95`

**What:** The dev-insecure root is written and read as a bare 32-byte file protected only by 0o600 permissions, with no encryption and no MAC/signature over the stored bytes (write_secure lines 84-95; unlock read at lines 183-188 just `try_into()` to [u8;32]). There is no confidentiality (any same-uid process reads it) and no integrity (a tampered 32-byte file silently yields a different identity + a different Stronghold key derivation, which would simply fail to open the existing snapshot or, worse, create/operate under an attacker-chosen identity).

**Attack:** On a stolen device using the dev-insecure path, or via any same-uid local process, the attacker reads peer-id-<slot>.dev-root-secret to fully impersonate the identity and derive the Stronghold key (stronghold_vault.rs:17-24) to decrypt the vault. Alternatively the attacker overwrites the 32 bytes; because there is no integrity check, the app silently adopts the substituted root as its identity on next unlock.

**Evidence:** dev_insecure.rs:84-95 `write_secure` does `fs::write(&tmp, data)` (plaintext) + chmod 0o600, no crypto. Lines 184-187 read the file and `try_into()` with only a length check. The same root feeds derive::ed25519_public (line 148) and the Stronghold key.

**Fix:** This path is dev-only by intent, but its blast radius is large because the same root keys the vault. Beyond the release-build hardening above: avoid persisting the root in cleartext even in dev (e.g. derive it from an OS keyring entry), or at minimum store an authenticated wrapper (encrypt-then-MAC under an OS-protected key) and reject the file on MAC failure so silent substitution is caught.


### [Low] #32 — did:key decoder accepts any multibase encoding — non-canonical DID strings for the same key are not normalized before string-equality authorization

- **Dimension:** identity-signing  ·  **Verifier votes:** 2 confirm / 1 refute
- **Location:** `libs/aven-db/src/did_key.rs:30-47`

**What:** ed25519_public_from_peer_did calls multibase::decode (did_key.rs:35), which accepts ANY multibase base prefix (z/base58btc, f/base16, m/base64, etc.), while peer_did_from_ed25519 always emits Base58Btc 'z' (line 21). Downstream authorization compares DIDs by raw string equality — peer_did_matches does `a.trim() == b.trim()` (caps.rs:548) and biscuit `owns($p, identity)` facts store the DID as a literal string. So a single Ed25519 key has multiple valid DID spellings, but only the canonical 'z' form ever appears in stored grants.

**Attack:** Primarily a fail-closed correctness/robustness hazard rather than escalation: a peer that presents an alternate-base DID for an authorized key will NOT string-match the biscuit's stored 'z…' DID and is wrongly denied. The escalation direction is blocked because decode validates length and VerifyingKey::from_bytes (line 45). However, any code path that takes an attacker-supplied DID string, decodes it to a key, and then later re-uses the ORIGINAL string for an equality check (rather than re-encoding canonically) can be desynchronized — e.g. an owner-binding author_did or a peers-roster DID stored in non-canonical form would mismatch later canonical comparisons, producing inconsistent allow/deny across components.

**Evidence:** `let (_base, decoded) = multibase::decode(rest)...` (did_key.rs:34-35) — the discarded `_base` means the input base is not constrained to Base58Btc, yet encode hardcodes `multibase::encode(Base::Base58Btc, &buf)` (did_key.rs:21). Authorization equality: `a.trim() == b.trim()` (caps.rs:548).

**Fix:** Canonicalize on decode: reject any did:key whose multibase prefix is not 'z' (Base58Btc), or normalize every DID by re-encoding (peer_did_from_ed25519(decoded_key)) before storing or comparing, so one key has exactly one DID string across the biscuit facts, owner-bindings, and roster.


---

## Refuted / Lower-Confidence (considered, did NOT meet the ≥2/3 bar)

These were raised by a finder but the adversarial verifiers did not confirm them (vote count shown). Several themes here were *absorbed* into confirmed findings above (e.g. dek_version rollback → #3/#28; envelope-stripping + issuer downgrade → #31). Worth a glance but not actioned as confirmed.

- [Low] Single static KEK shared across all dek_versions and across keyshare-vs-group-key roles — domain separation rests only on AEAD AAD, not on the derived key (libs/aven-caps/src/crypto.rs) — 0/3 confirmed
- [Medium] Keyshare AAD omits the wrapper/granter DID while the reader picks the DH counterparty from the relay-tamperable wrapper_did column (libs/aven-caps/src/crypto.rs) — 1/3 confirmed
- [Low] XChaCha20-Poly1305 envelopes are non-key-committing; the multi-DEK trial-decrypt loop relies on this and has no commitment safeguard (app/src-tauri/src/jazz/jazz_engine.rs) — 1/3 confirmed
- [Medium] Server relay apply gate accepts any bindingless row (default-allow) with no spark-scoped-table check (libs/aven-node/src/main.rs) — 1/3 confirmed
- [Low] Delegated-grant prefix coverage uses bare starts_with with no enforced delimiter — latent prefix-confusion privilege escalation (libs/aven-caps/src/caps.rs) — 1/3 confirmed
- [Low] Peer-auth challenge uses non-strict Ed25519 verification (Verifier::verify, not verify_strict) — accepts malleable/non-canonical signatures (libs/aven-p2p/src/challenge.rs) — 1/3 confirmed
- [Medium] Challenge nonce is generated but never recorded server-side as single-use — captured ClientAuth replayable within the 5-minute TTL (only relay defense on wss) (libs/aven-p2p/src/challenge.rs) — 0/3 confirmed
- [Low] Client signs the peer-auth message over server-supplied domain/network/uri fields without validating them against expected values (libs/aven-p2p/src/ws_client.rs) — 0/3 confirmed
- [High] `secrets_reveal` exfiltrates every Stronghold secret to the WebView with no per-call authorization (libs/tauri-plugin-vault/src/commands.rs) — 1/3 confirmed
- [High] AVENOS_DEV_INSECURE_IDENTITY env var forces plaintext-root identity path in Linux/Windows RELEASE builds (libs/tauri-plugin-self/src/dev_insecure.rs) — 1/3 confirmed
- [High] DEK-version rollback: relay-tamperable plaintext `current_dek_version` lets revoked peers read post-rotation data (app/src-tauri/src/jazz/jazz_engine.rs) — 1/3 confirmed
- [Medium] Read path trial-decrypts every held DEK and ignores the AAD-bound `dek_version`, so old-version ciphertext is always accepted (rollback/replay of sealed cells) (app/src-tauri/src/jazz/jazz_engine.rs) — 1/3 confirmed
- [Medium] Envelope-stripping downgrade: any sealed value not prefixed `v1` is returned as unauthenticated cleartext (app/src-tauri/src/jazz/jazz_engine.rs) — 1/3 confirmed
- [Medium] AuthResult (server_did the client adopts as its only sync peer) is sent unauthenticated; on wss a proxy can substitute the server identity (libs/aven-p2p/src/transport.rs) — 0/3 confirmed
- [Low] Peer-auth signature verified with non-strict Ed25519 verify() (signature malleability / non-canonical acceptance) (libs/aven-p2p/src/challenge.rs) — 0/3 confirmed
- [Low] Challenge replay nonce is never recorded as single-use; only a 5-minute wall-clock TTL gates it (libs/aven-p2p/src/challenge.rs) — 1/3 confirmed
- [Low] Pinned server cert verifier ignores certificate expiry, SAN, and intermediates — no rotation/revocation path (libs/aven-p2p/src/tls.rs) — 1/3 confirmed
- [High] Inbound apply gate hardcodes AccOp::Write for all rows including deletes — the distinct Delete capability is never enforced on sync (libs/aven-db/src/sync_manager/inbox.rs) — 1/3 confirmed
- [Low] Owner-binding and edit-signature verification use non-strict ed25519 verify (signature malleability) on the inbound apply gate (libs/aven-caps/src/ownership.rs) — 0/3 confirmed