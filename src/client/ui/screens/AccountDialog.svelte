<script lang="ts" module>
  export type AccountView = "signin" | "create" | "recover" | "code" | "profile" | "privacy";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  /**
   * Accounts on the start screen (3.7, D-037): sign in, create an account (name + password,
   * no email), Google, a forgotten password (the recovery code), your profile (rename, sign
   * out, delete) and the privacy note. Optional — guests play as before.
   */
  import {
    MAX_NAME_LENGTH,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
  } from "../../../shared/accounts.ts";
  import {
    account,
    AccountError,
    deleteAccount,
    joinedDate,
    recover,
    register,
    rename,
    signIn,
    signInWithGoogle,
    signOut,
  } from "../../app/account.svelte.ts";

  interface Props {
    view: AccountView;
    onClose: () => void;
  }

  let { view: initial, onClose }: Props = $props();

  // Opened on `initial`; the dialog then moves between views by itself.
  let view = $state<AccountView>(untrack(() => initial));
  let name = $state("");
  let password = $state("");
  let code = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** The recovery code to show once (after creating an account or recovering it). */
  let shownCode = $state("");
  let saved = $state(false);
  let copied = $state(false);
  let confirmDelete = $state(false);
  let newName = $state(account.me?.name ?? "");
  let renamed = $state(false);

  const me = $derived(account.me);
  const titles: Record<AccountView, string> = {
    signin: "Sign in",
    create: "Create an account",
    recover: "Forgot your password?",
    code: "Your recovery code",
    profile: "Your profile",
    privacy: "Privacy",
  };

  function go(next: AccountView): void {
    view = next;
    error = null;
    password = "";
    code = "";
    confirmDelete = false;
  }

  /** Runs an account call, showing its refusal. */
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await action();
    } catch (e) {
      error = e instanceof AccountError ? e.message : "Something went wrong.";
    } finally {
      busy = false;
    }
  }

  const submitSignIn = () =>
    run(async () => {
      await signIn(name, password);
      onClose();
    });

  const submitCreate = () =>
    run(async () => {
      shownCode = await register(name, password);
      go("code");
    });

  const submitRecover = () =>
    run(async () => {
      shownCode = await recover(name, code, password);
      go("code");
    });

  const submitRename = () =>
    run(async () => {
      await rename(newName);
      newName = account.me?.name ?? newName;
      renamed = true;
      setTimeout(() => (renamed = false), 1500);
    });

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shownCode);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && view !== "code") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && view !== "code" && onClose()}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
    <header>
      <h2 id="account-title">
        {view === "profile" && me?.needsName ? "Pick your name" : titles[view]}
      </h2>
      {#if view !== "code"}
        <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
      {/if}
    </header>

    {#if view === "signin" || view === "create" || view === "recover"}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void (view === "signin"
            ? submitSignIn()
            : view === "create"
              ? submitCreate()
              : submitRecover());
        }}
      >
        <label for="account-name">Name</label>
        <input
          id="account-name"
          bind:value={name}
          maxlength={MAX_NAME_LENGTH}
          autocomplete="username"
          required
        />
        {#if view === "recover"}
          <label for="account-code">Recovery code</label>
          <input
            id="account-code"
            bind:value={code}
            autocomplete="off"
            spellcheck="false"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            required
          />
        {/if}
        <label for="account-password">{view === "recover" ? "New password" : "Password"}</label>
        <input
          id="account-password"
          type="password"
          bind:value={password}
          minlength={view === "signin" ? undefined : MIN_PASSWORD_LENGTH}
          maxlength={MAX_PASSWORD_LENGTH}
          autocomplete={view === "signin" ? "current-password" : "new-password"}
          required
        />
        {#if view === "create"}
          <p class="note">
            No email needed. You'll get a recovery code — keep it, it's the only way back in if you
            forget your password. At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button type="submit" class="primary" disabled={busy}>
          {busy
            ? "One moment…"
            : view === "signin"
              ? "Sign in"
              : view === "create"
                ? "Create account"
                : "Set new password"}
        </button>
      </form>

      {#if account.google && view !== "recover"}
        <div class="or"><span>or</span></div>
        <button type="button" class="google" onclick={signInWithGoogle}>Continue with Google</button
        >
      {/if}

      <p class="links">
        {#if view === "signin"}
          <button type="button" class="link" onclick={() => go("create")}>Create an account</button>
          ·
          <button type="button" class="link" onclick={() => go("recover")}
            >Forgot your password?</button
          >
        {:else}
          <button type="button" class="link" onclick={() => go("signin")}>I have an account</button>
        {/if}
        ·
        <button type="button" class="link" onclick={() => go("privacy")}>Privacy</button>
      </p>
    {:else if view === "code"}
      <p class="note">
        Write this down or save it somewhere safe. If you forget your password, this code lets you
        set a new one. It's shown only now.
      </p>
      <div class="code-row">
        <code class="code">{shownCode}</code>
        <button type="button" class="secondary" onclick={copyCode}
          >{copied ? "Copied" : "Copy"}</button
        >
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={saved} />
        <span>I saved my recovery code</span>
      </label>
      <button type="button" class="primary" disabled={!saved} onclick={onClose}>Done</button>
    {:else if view === "profile" && me}
      {#if me.needsName}
        <p class="note">
          Choose the name other players will see. It's yours alone while you keep the account.
        </p>
      {/if}
      <form
        class="rename"
        onsubmit={(e) => {
          e.preventDefault();
          void submitRename();
        }}
      >
        <label for="profile-name">Name</label>
        <div class="row">
          <input id="profile-name" bind:value={newName} maxlength={MAX_NAME_LENGTH} required />
          <button
            type="submit"
            class="secondary"
            disabled={busy || (newName.trim() === me.name && !me.needsName)}
            >{renamed ? "Saved" : "Save"}</button
          >
        </div>
      </form>
      <dl class="stats">
        <div>
          <dt>Joined</dt>
          <dd>{joinedDate(me.joined)}</dd>
        </div>
        <div>
          <dt>Games</dt>
          <dd>{me.games}</dd>
        </div>
        <div>
          <dt>Wins</dt>
          <dd>{me.wins}</dd>
        </div>
      </dl>
      <p class="note">
        Online games with at least 2 players count. Signed in with {me.method === "google"
          ? "Google"
          : "a name and password"}. Anyone can see your name, join date, games and wins.
      </p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if confirmDelete}
        <div class="danger-zone" role="alert">
          <p>Delete your account for good? Your name, games and wins are erased right away.</p>
          <div class="row">
            <button
              type="button"
              class="danger"
              disabled={busy}
              onclick={() =>
                run(async () => {
                  await deleteAccount();
                  onClose();
                })}>Delete my account</button
            >
            <button type="button" class="secondary" onclick={() => (confirmDelete = false)}
              >Keep it</button
            >
          </div>
        </div>
      {:else}
        <div class="row">
          <button
            type="button"
            class="secondary grow"
            disabled={busy}
            onclick={() =>
              run(async () => {
                await signOut();
                onClose();
              })}>Sign out</button
          >
          <button type="button" class="secondary grow" onclick={() => (confirmDelete = true)}
            >Delete account</button
          >
        </div>
      {/if}
      <p class="links">
        <button type="button" class="link" onclick={() => go("privacy")}>Privacy</button>
      </p>
    {:else if view === "privacy"}
      <div class="privacy">
        <p>
          <strong>Guests:</strong> nothing about you is stored. Your name lives only in the game you join
          and in this browser.
        </p>
        <p>
          <strong>With an account we keep:</strong> your name, the day you joined, your games and wins
          — and either Google's account number for you, or your password and recovery code scrambled so
          nobody can read them. With Google we ask only to confirm who you are: we never get your email,
          name or photo.
        </p>
        <p><strong>Public:</strong> anyone can see an account's name, join date, games and wins.</p>
        <p>
          <strong>Cookie:</strong> one cookie keeps you signed in for 30 days. No ads, no tracking, nothing
          sold or shared.
        </p>
        <p>
          <strong>Logs:</strong> the server's short-lived logs can include connection addresses (to stop
          abuse); they aren't stored with accounts.
        </p>
        <p>
          <strong>Deleting:</strong> Profile → Delete account erases everything right away, and your name
          is free again.
        </p>
      </div>
      <button type="button" class="secondary" onclick={() => go(me ? "profile" : "signin")}
        >Back</button
      >
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: rgb(0 0 0 / 0.45);
    pointer-events: auto;
  }

  .dialog {
    width: min(360px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--surface-glass);
    backdrop-filter: blur(var(--surface-blur));
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    color: var(--text-primary);
    text-align: left;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 650;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  input:not([type="checkbox"]) {
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--surface-hairline);
    border-radius: var(--radius-control);
    background: rgba(0, 0, 0, 0.25);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }

  button {
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius-control);
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .primary {
    height: 40px;
    margin-top: var(--space-1);
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 650;
  }

  .secondary,
  .google {
    height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--surface-hairline);
    background: transparent;
    color: var(--text-primary);
    font-weight: 600;
  }

  .secondary:hover:not(:disabled),
  .google:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .danger {
    height: 36px;
    padding: 0 var(--space-3);
    border: none;
    background: var(--color-danger);
    color: #fff;
    font-weight: 650;
  }

  .close {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 20px;
    line-height: 1;
  }

  .or {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .or::before,
  .or::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--surface-hairline);
  }

  .links {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-align: center;
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-secondary);
    text-decoration: underline;
    font-size: var(--text-sm);
  }

  .link:hover {
    color: var(--text-primary);
  }

  .note,
  .privacy p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .privacy {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .privacy strong {
    color: var(--text-primary);
  }

  .error {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--text-sm);
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  .grow {
    flex: 1;
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .code {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: rgba(0, 0, 0, 0.3);
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 15px;
    letter-spacing: 0.04em;
    user-select: all;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 500;
    cursor: pointer;
  }

  .check input {
    accent-color: var(--accent);
  }

  .stats {
    display: flex;
    gap: var(--space-2);
    margin: 0;
  }

  .stats div {
    flex: 1;
    padding: var(--space-2);
    border-radius: var(--radius-control);
    background: rgba(255, 255, 255, 0.05);
    text-align: center;
  }

  .stats dt {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .stats dd {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .danger-zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--color-danger) 60%, transparent);
    border-radius: var(--radius-control);
  }

  .danger-zone p {
    margin: 0;
    font-size: var(--text-sm);
  }

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
