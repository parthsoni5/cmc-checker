# Content Compare

Find out why something works on one environment (e.g. UAT) but not another (e.g. PROD) by comparing their Sitecore content side by side.

Two files:

| File | What it does | Where it runs |
|---|---|---|
| `Export-Content.ps1` | Reads content from Sitecore and downloads it as a `.json` file. **Read-only. It changes nothing.** | Inside Sitecore (PowerShell ISE) |
| `compare.html` | Compares two of those files and lists the differences. | Your browser. Nothing is uploaded. |

## Before you start

- Check with your tech lead that it's OK to run a read-only script on PROD. Some teams want to know before anything is run there.
- Run it outside busy hours if you're reading a large part of the content tree.

## Step 1: Export from the working environment (e.g. UAT)

1. Log in to the UAT CM and open the **Launchpad**.
2. Click **PowerShell ISE**.
3. Open `Export-Content.ps1` in Notepad, copy everything, and paste it into the ISE.
4. At the top, under **SETTINGS**, change:
   - `$EnvironmentName` to `"UAT"`
   - `$RootPaths` to the part of the site with the issue, e.g. `"/sitecore/content/<YourSite>/Home"`
   - Leave `$Database = "master"` for now.
5. Click **Execute**. If Sitecore asks for your password again, that's normal.
6. A file such as `content-UAT-master-20261012-1530.json` downloads.

## Step 2: Export from the environment with the issue (e.g. PROD)

Repeat Step 1 on the PROD CM with `$EnvironmentName = "PROD"` and **the same paths**.

## Step 3: Compare

1. Double-click `compare.html` to open it in your browser.
2. Drop the UAT file in box 1 and the PROD file in box 2.
3. Click **Compare**.

You'll see counts at the top. Click one to filter, then click any item to see exactly which fields differ. **Download CSV** gives you a list to share with the team.

To see what the page looks like first, click **Try with demo data**.

## Useful comparisons

| Box 1 | Box 2 | What it finds |
|---|---|---|
| UAT `master` | PROD `master` | Content that differs between environments |
| UAT `web` | PROD `web` | Differences in what the live sites actually show |
| PROD `master` | PROD `web` | Content edited on PROD but **not published**. This is a very common cause. |

To export the published content, set `$Database = "web"`.

## What the results mean

| Result | Meaning |
|---|---|
| Missing in target | The item exists in box 1 but not box 2 |
| Language version missing | The item exists, but not in that language |
| Only in target | The item exists only in box 2 |
| Field values differ | The same item has different content. `__Renderings` / `__Final Renderings` differences mean the page layout (components) differs. |
| Path differs | The item was moved or renamed |
| Template differs | The item is built on a different template |
| Same path, different ID | The item was created separately in each environment, so anything linking to it by ID can break |

## XM Cloud: no export needed

Open `compare.html` and pick what you want to check:

| Option | What it finds | What you need |
|---|---|---|
| **Unpublished changes** | Content edited in the CMS but not published, templates never published, deletions not published | The **Preview** and **Live** Context IDs of one environment |
| **Two environments** | Differences between e.g. UAT and Prod | One Context ID per environment, both **Live** or both **Preview** |

Context IDs are in XM Cloud Deploy → your environment → **Developer settings** (use the Preview/Live switch).
Treat them like passwords: don't commit them or paste them into chats.

Then enter the start path. Use the **site item**, e.g. `/sitecore/content/<Collection>/<Site>`, so Home, Data and Presentation are all included. Click **Compare**.

Click **See an example** to try the page with made-up data first.

### Save your projects so you don't paste IDs every time

Open the page through the local server (`http://localhost:8765/compare.html`). Then:

1. In the **Projects** sidebar, click **+ Add project**.
2. Enter the project name, start path and languages. For each environment (DEV, UAT, PROD are pre-filled, so add or remove as needed), paste its **Preview** and **Live** Context IDs. Leave blank any you don't have.
3. Click **Save project**.

Next time, just click the project in the sidebar. Choose the environment(s) and the IDs fill in for you. The dots next to each environment show what's saved: ● both IDs, ◐ only one.

**Where it's saved:** in this browser, on this computer only. Clearing the browser's site data removes it.
- **Export** downloads your projects as `projects.local.json` (for backup or a new laptop). **Import** loads one back.
- **Remove all** deletes every saved project and ID from the browser.
- A `projects.local.json` file in this folder is also picked up automatically and shown with a "file" tag.

**Keep the IDs safe:** they're credentials.
- Don't email or commit the exported file. It's already in `.gitignore`.
- Always start the server with `-a 127.0.0.1`, so only your own computer can reach it.

### Reading the results

- The **headline** says how many items differ and where to start.
- The **cards** group results by what to do (e.g. *Needs publishing*, *Templates not on Live*, *Removed but still live*). Click one to filter.
- Open an item to see a plain-English explanation, highlighted text changes and, for pages, a **component table** showing which components were added, removed or changed.
- **Copy ID** copies the ID with `{ }` brackets, ready to paste into Content Editor search.
- **Copy summary** gives you a short text version for Teams or Jira; **Download CSV** gives the full list.

Keep `edge-core.js` in the same folder as `compare.html`; the page needs it.

### If the page says the browser blocked the request

Browsers can block pages opened by double-clicking (a `file://` address) from calling Experience Edge.

**Option 1 (easiest):** open the page through a small local server instead. In a terminal in this folder:

```
npx http-server -p 8765 -c-1 -a 127.0.0.1
```

Then open `http://localhost:8765/compare.html`. Press Ctrl+C in the terminal when you're done.

**Option 2:** run the fallback script (needs Node.js) in PowerShell, from this folder, once for each side:

```
$env:EDGE_CONTEXT_ID = "<Preview Context ID>"
node edge-export.mjs --name preview --path "/sitecore/content/<Collection>/<Site>/Home"

$env:EDGE_CONTEXT_ID = "<Live Context ID>"
node edge-export.mjs --name live --path "/sitecore/content/<Collection>/<Site>/Home"
```

Then drop the **preview** file in box 1 and the **live** file in box 2.

## Important

- The suggested changes are **for investigation only**. Any change to PROD, whether content, publishing or config, needs approval from the technical owner before it's made.
- The export skips Sitecore's housekeeping fields (dates, "updated by", revision numbers) because they always differ. It keeps layout, publishing and workflow fields.
- It compares **content only**. If the content matches, the cause may be code, config or cache. Raise that with the backend team.
