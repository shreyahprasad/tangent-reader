# Privacy

Tangent Reader has no accounts, no server that keeps your reading, no cookies and no analytics.
Here is where each thing goes.

## Stays in your browser

- **Your reading:** the articles you add, your threads, Claude's answers and the log of every call
  with its cost. They live in this browser's storage (IndexedDB) on this device only. Nothing syncs.
  Clearing the site's data, or Delete everything in Settings, erases them. Export a backup first if
  you may want them back.
- **Your API key:** kept in this tab only, or on this device if you choose. It never goes into a
  backup or the call log.
- **Your settings:** the model, the theme and your monthly limit on this device, and unsent drafts in this tab.

## Goes to Anthropic

When you ask a question, this browser sends it straight to Anthropic's API
(`api.anthropic.com`) with your key: the whole article, the sentence you tapped and the path down to
it, and the thread so far. With Look it up on, Claude also searches the web on Anthropic's side.
Anthropic's own terms and privacy policy cover what they keep.

Checking a key asks Anthropic to list one model, which costs nothing.

## Goes through the Worker

Pasting text and opening a file never leave your browser. A link does: your browser can't fetch
most sites itself, so it asks this site's Cloudflare Worker (`/fetch`) to get the page.

- The Worker gets the link and passes the page back. It keeps nothing and logs nothing.
- The site sees the Worker's address, not yours.
- To refuse private and local addresses, the Worker looks up the site's address through
  Cloudflare's DNS (`cloudflare-dns.com`), so Cloudflare sees the site's name.
- Your address is used for one thing: a rate limit of 20 links a minute, which Cloudflare counts
  for a minute and then forgets.

## Nothing else

The page loads its code and fonts from this site only. Its security policy blocks every other
script and every connection except this site and Anthropic's API (`src/shell/headers.ts`).
