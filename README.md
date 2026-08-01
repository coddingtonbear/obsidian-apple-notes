# Apple Notes Sync

- **Obsidian Community page:** https://community.obsidian.md/plugins/icloud-notes

Sync a folder in your Obsidian vault with your Apple Notes, in both directions,
from any operating system — Linux, Windows, or macOS.

This plugin is a thin Obsidian front-end for the [`icloud-md`][icloud-md] CLI,
which turns your Apple Notes into a folder of real Markdown files and syncs your
edits back to iCloud as if you'd typed them into Notes.app all along. The plugin
lets you drive that from inside Obsidian — connect a folder, pull, push, and
(optionally) sync on a schedule — without ever leaving your vault.

> [!WARNING]
> **This is not an official or supported Apple integration, and data loss is a
> real possibility.** `icloud-md` works by reverse-engineering the private
> CloudKit service behind `www.icloud.com/notes`, and every push makes real
> writes to your live Notes account. Read [`icloud-md`'s own safety notice][icloud-md-safety]
> in full before you point this at notes you care about, keep the synced folder
> under version control (or otherwise backed up), and try a push against a
> disposable test note first.

## Features

- **Bidirectional sync, not just export** — pull remote changes and push local
  edits from inside Obsidian. Editing happens in your vault; the plugin
  reconciles both sides through `icloud-md`.
- **Connect a single vault folder** — bind one folder to your Apple Notes and
  keep the rest of your vault untouched.
- **One-click actions everywhere** — a ribbon icon, a status-bar item, and
  commands (Pull now, Push now, Reauthenticate, Show status) all open the same
  quick menu.
- **At-a-glance status** — the status-bar item shows whether you're connected,
  syncing, up to date, or have local changes waiting to be pushed.
- **Optional scheduled sync** — off by default. Turn it on and set how many
  minutes to wait between automatic pull-then-push runs.
- **Safe by construction** — overlapping runs can't happen: every action
  (manual or scheduled) is serialized through a single queue, so a scheduled
  sync never collides with a button you just clicked.

## Requirements

- **Desktop only.** This plugin shells out to a local command-line tool, so it
  does not work on Obsidian mobile.
- **Node.js 20+** and the **[`icloud-md`][icloud-md] CLI** installed and on your
  `PATH`:

  ```sh
  npm install -g icloud-md
  ```

  If Obsidian can't find the binary (GUI-launched apps often don't inherit your
  shell's `PATH`), you can point the plugin at it explicitly — see
  [Advanced settings](#advanced-settings) below.
- An Apple ID whose Notes you want to sync. Sign-in happens through Apple's own
  browser pages; `icloud-md` never sees your password. Note that it likely
  requires **Advanced Data Protection to be disabled** on the account — see the
  `icloud-md` docs.

## Usage

1. Install and enable the plugin.
2. Open **Settings → Apple Notes Sync**.
3. Enter a **vault folder** to sync into — an empty or new folder works best.
4. Click **Connect**. This runs `icloud-md clone`, which opens an Apple sign-in
   window in your browser; sign in as you normally would (password, 2FA,
   whatever your account requires). The first ever run also downloads a
   Chromium browser for sign-in (a one-off ~150 MB fetch).
5. Once connected, use **Pull** and **Push** from the settings tab, the ribbon
   icon, the status-bar item, or the commands.

Sign-ins for the same Apple ID are remembered, so you typically won't need to
re-authenticate on subsequent syncs.

### Settings

Once connected, the settings tab offers:

- **Pull / Push** — fetch remote changes into the folder, or send local edits
  back to iCloud.
- **Reauthenticate** — force a fresh Apple sign-in for this folder, e.g. if a
  session goes stale.
- **Disconnect** — forget the binding and stop auto-sync. This is
  plugin-local only: your synced files and your iCloud-side sign-in are left
  untouched, so you can reconnect later.
- **Sync automatically** — off by default. When enabled, the plugin pulls then
  pushes on a fixed interval, and an **Auto-sync interval** field lets you set
  the number of minutes between runs.

### Advanced settings

- **icloud-md binary location** — leave blank to use `icloud-md` from your
  `PATH`, or set an explicit path if Obsidian can't find it. The directory
  containing it is added to `PATH` automatically, so with a Node version
  manager this also lets `icloud-md` find the `node` sitting beside it.
- **Extra PATH entries** — directories to prepend to `PATH` when spawning
  `icloud-md` (for example, wherever your Node version manager installs global
  binaries). Useful because a GUI-launched Obsidian doesn't inherit your
  shell's `PATH`. Separate multiple directories the way your platform's `PATH`
  does: with `;` on Windows, `:` elsewhere.

Finding the right values:

| Platform | Command | Typical result |
| --- | --- | --- |
| macOS / Linux | `which icloud-md` | `/Users/you/.nvm/versions/node/v24.14.1/bin/icloud-md` |
| Windows | `where icloud-md` | `C:\Users\you\AppData\Roaming\npm\icloud-md.cmd` |

## Commands

| Command | Action |
| --- | --- |
| **Pull now** | Fetch remote changes into the connected folder. |
| **Push now** | Send local edits back to iCloud. |
| **Reauthenticate** | Force a fresh Apple sign-in for the connected folder. |
| **Show status** | Report whether you're up to date or have pending changes. |

## How it works

The plugin does not talk to iCloud itself. It spawns the `icloud-md` CLI with
its `--json` flag and parses the structured results, streaming progress back
into Obsidian's UI. All the real work — authentication, the CloudKit protocol,
three-way merges, conflict handling, version history — lives in `icloud-md`. See
its [documentation][icloud-md] for the full picture of what happens under the
hood and what the safety guarantees are.

## Development

```sh
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

- `npm run dev` — rebuild on change during development.
- `npm run build` — production bundle (`main.js`).
- `npm test` — unit tests for the pure logic (CLI protocol parsing and the sync
  queue), run with `tsx --test`.

To try it in a real vault, symlink or copy `main.js`, `manifest.json`, and
`styles.css` into `<vault>/.obsidian/plugins/icloud-notes/` and reload
Obsidian.

## License

MIT

[icloud-md]: https://github.com/coddingtonbear/icloud-md
[icloud-md-safety]: https://github.com/coddingtonbear/icloud-md#readme
