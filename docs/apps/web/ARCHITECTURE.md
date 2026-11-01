# Web architecture

The website lets people assemble a Friend, inspect the collection and submit
mint transactions. Canonical artwork comes from `collection/`; the contract
remains authoritative for ownership, availability, sale phase and prices. Start
with the [web app guide](../../../apps/web/README.md) to run it locally, or the
[mint guide](../../contracts/core/architecture/MINTING.md) for the purchase protocol.

## Source and build

The application shell is `apps/web/index.html`, with styles under
`apps/web/assets/` and browser modules under `apps/web/src/`. Those modules
import the shared art model from `collection/`. Both `npm run build` and
`npm run build:production` generate the main browser bundle and lazy wallet
chunks, alongside the collection and contract build outputs. Generated bundles
are ignored; edit their source modules. Local runtime configuration lives at
`apps/web/chain-config.json`, exposed by the server as `/chain-config.json`.

The browser reads `chain-config.json` at runtime. Copy
`apps/web/config/chain-config.example.json` for a blank local configuration or
generate it with `npm run local:deploy`.

## Mainnet site modes

| Profile | Mode | Purpose |
| --- | --- | --- |
| `apps/web/config/mainnet-staging-site.json` | `read-only` | Review mainnet artwork and history without wallet access |
| `apps/web/config/mainnet-site.json` | `wallet` | Connect a wallet and mint when the contract phase allows it |

Both profiles derive one chain-1 configuration from the verified deployment
record plus explicit public RPC, snapshot and explorer settings. Wallet mode
also requires the reviewed Reown project and metadata. The exporter writes an
ignored static site under `output/site/`, publishes an explicit file allowlist,
hashes executable/style entry points, and records SHA-256 values and the mode in
`site-manifest.json`. Missing or inconsistent deployment, catalog or mode data
causes the export to fail.

Read-only is a first-class runtime mode, not a missing-project-ID fallback. It
omits wallet configuration and the dynamically imported Reown graph from the
static export. The browser does not restore or attach an injected wallet, the
header identifies the site as a read-only preview, mint actions stay disabled,
and myFriends explains that wallet access is unavailable. Chain and snapshot
reads continue normally, so reviewers see the configured mainnet collection and
can inspect its canonical history without any transaction path.

## Mint and wallet boundaries

The frontend:

- renders all six chosen traits locally from canonical data;
- indexes mint events and verifies the pinned deployment/code/catalog identity;
- supports injected wallets and lazy-loaded Reown AppKit;
- does not send the public-mint selection preimage to RPC before commitment maturity;
- stores recovery state durably before wallet prompts;
- preserves exposed/pending evidence across reloads and tab races;
- displays exact wei-derived ETH prices; optional USD values are display-only.

## Responsive application shell

At compact widths (up to 820 CSS pixels, plus shallow phone landscape up to
950 pixels), the same DOM, genotype, renderer and chain state switch to the
mobile product shell. Builder is artwork-first: six category tabs drive one
lazy-painted horizontal value rail, while the mirrored mint/status control is the
only exposed primary action. The artwork preview stays fixed inside the Builder
viewport; category tabs, the value rail and the primary action share a separate
vertical scroll region, with the action following the traits instead of covering
them.

A circular lower-left die control creates a random version and rotates a
CSS 3D cube with six permanent faces and attached pips. Opposite faces sum to seven;
the solid settles into one of 24 valid orientations beneath a fixed isometric
camera. Reduced motion changes orientation immediately without animation. The lower-right
counter reports its position in saved look history, and horizontal preview swipes
browse that same history. A mobile double-tap on the artwork adds an available
combination to Wishlist and plays a lightweight heart burst; it is idempotent, so
only the explicit heart button can remove a saved combination. Controls and links
inside Preview are excluded from the gesture. Desktop retains the explicit Shuffle and arrow controls;
mobile does not duplicate them below the trait rail.

Builder and Spiral have distinct hash routes so
the fixed Builder, Spiral, Wishlist, History and About navigation preserves browser Back, while trait changes
continue to update the canonical genotype URL. Route-only mobile navigation does
not rebuild hidden desktop Builder controls. Trait selection updates the existing
rail in place, smoothly centers the active value (including the first and last
options), retains already painted thumbnails for the active category, and schedules
new canvases within a small per-frame budget. Programmatic centering pauses lazy
painting until scrolling settles, so passing options do not create a render spike.
Hidden Spiral artwork and intro motion do not run behind Builder.

On mobile, the
document is locked to the visual viewport so horizontal drags and scroll-boundary
gestures cannot pull the application chrome or background away from the screen.
About, Collection, Wishlist, History and myFriends scroll inside bounded content
panels between the fixed header and bottom navigation. Those panels are also the
lazy-render boundaries for their galleries; History creates cards in batches of 24
and uses smaller mobile backing canvases. The shared artwork-scale control stays
fixed above the bottom navigation in Collection, Wishlist and History instead of
moving to the end of a long gallery. Fixed navigation uses safe-area insets. Builder
and Spiral use dedicated inline vector icons. Mobile Spiral replaces its desktop
transport, scrubber and zoom buttons with one-finger travel and two-finger pinch
zoom, retaining one circular reset control for returning to the initial position
and 100% scale.

## Account, project and contract evidence

The mobile header wallet opens a compact account dialog with the connected address,
owned myFriends and wallet actions, replacing myFriends as a primary mobile
destination. About supplies the project, social, film, marketplace and verified
contract links that are otherwise available through the desktop footer. Mobile
contacts and collection resources use labelled circular icons, including the
Twitter bird rather than the X mark. Each protocol claim exposes the exact active
deployment through Etherscan source and EVM.Now links plus a native expandable
Solidity excerpt. Its GitHub link targets the canonical
[`MagicForestLand/mycelium`](https://github.com/MagicForestLand/mycelium/)
repository; availability follows that repository's launch visibility. The excerpts
use lightweight native token colouring and contain their own horizontal
overflow, so proof remains readable without changing the protocol-card width.

An additional two-market card distinguishes deterministic primary Spiral pricing
from owner-priced secondary resale, links directly to the Builder and OpenSea when
that market is available, and presents `268,435,456` (`2^28`) as an intentionally
unreachable mathematical horizon rather than a sellout target. The product copy
explains market risks and possible feedback between the two markets. The
implementation contains no oracle or automatic cross-market pricing.

Fundraising totals and the `GOAL` label share the right content edge at every
viewport. Refresh actions use one reusable circular SVG control instead of font
glyphs, with a compact text-sized variant beside the exchange-rate line. Its Build
CTA opens desktop Traits or the mobile Builder; its Collection CTA opens the shared
on-chain Collection view. Price-step and royalty explanations link to the active
deployment contract, while the redundant live-collection strip is omitted. Compact
mobile notifications sit below the header, do not intercept input and avoid the
primary controls. Nested Builder rails contain their horizontal overscroll while
retaining native vertical intent in the controls panel. In portrait mobile layouts,
the controls scroller meets the top edge of the fixed navigation without a dead
bottom inset, preserving the available Safari visual viewport for the mint action.
Desktop controls are hidden rather than duplicated into a second
application or state model.

## Spiral geometry and playback

The classical Archimedean spiral is anchored at the exact centre of the workspace.
Its spacing between turns is constant and its screen direction matches the brand
mark: right and down from the centre, without viewport-dependent rotation. Zooming out extends the thread
to reveal more turns and positions; zooming in reveals fewer, with no movement of
the origin. The source thread always extends beyond the workspace and is clipped
by its edge, so zoom never exposes an artificial endpoint. Wheel, horizontal drag,
arrow buttons, and the position slider move mushrooms along a stationary thread;
the camera does not pan. `−`/`+` (or Ctrl/Command + wheel) change scale, `FIT`
restores the full view, and `NEXT MINT` brings the next position into view. The
slider can wind the entire collection into the spiral origin. Mushrooms stay fully
opaque along the thread and disappear immediately when they reach that point.

On first collection load, the sequence runs in reverse: the latest minted mushroom
leaves the origin immediately when the snapshot arrives, followed at a calm,
continuous pace by every earlier mint. The current-mint position
then fades in with its existing design, followed by enough future positions to fill
the current spiral viewport.

Until the collection state is ready, the empty thread draws itself once from the
origin across the roughly three visible turns and then remains complete. Its draw
uses a 3.2-second source-path animation, but hands off as soon as its stroke has
covered the viewport's circumscribed circle (roughly two and a half visible turns
at the desktop layout). The longer path remains as an invisible safety tail so
camera zoom never exposes an artificial endpoint. Collection-state loading begins in the page bootstrap and waits
behind this visual opening when it finishes first. The latest mushroom starts in
the same moment the thread reaches the viewport edge, with no empty pause between
the two acts. Separate inward and outward
play buttons animate browsing in both directions.

## Rendering and memory

The saved-look history remains durable, but its artwork is a viewport-sized
working set. Desktop History canvases outside that buffer are reset to 1×1;
mobile canvases are painted once at a smaller backing resolution and retained
until History is closed, avoiding repaint spikes during touch scrolling. Leaving
History releases every history canvas. The lightweight trait-ID
records stay in `localStorage`, so long exploration sessions retain their useful
back/forward history without retaining hundreds of megabytes of bitmap surfaces.
The external film on About is also created only while About is open and removed
on exit, preventing a hidden YouTube renderer from living behind the Spiral view.
Hidden Collection, Wishlist, History, and myFriends galleries are built only when
opened. Background block verification does not recreate artwork when the canonical
mint history is unchanged.

## Snapshots and RPC authority

`ChainReader` keeps each validated collection snapshot in browser `localStorage`.
On a repeat visit that snapshot starts the interface and intro immediately while
RPC verification and incremental block syncing continue in the background. The
empty loading thread is therefore reserved for first visits and missing caches.
Production and development configurations may provide an HTTPS `snapshotUrl`; a first
visit then requests it with a 2.5-second timeout. The web3 reader and this request start
immediately on `DOMContentLoaded`; they are not held behind wallet interaction or
a delayed fallback. The response is used only after its chain, contract,
deployment block, bytecode,
catalog, sequential token history, genotypes, phase counters, and pricing pass the
same validation as the local cache. Before seeding the UI, the client checks that the
snapshot block is recent and its hash is canonical through the configured RPC. It is
then persisted locally and rendered while the normal RPC refresh incrementally catches up. An
unavailable, stale, or invalid API response falls back to the RPC reader; a remote
snapshot never replaces a newer local one. The API is only a performance/indexing
layer: before any wallet-sensitive action the client reads phase, price, availability,
quota/claimed counts and supply from the configured contract/RPC. A structurally valid
snapshot and canonical block hash still do not make the API a transaction authority.
The production reader continues from the snapshot using contract logs; when the on-chain total is zero it
skips the empty log history entirely; once records exist it reads logs in bounded,
ordered ranges. Snapshots larger than 2 MB remain usable in memory but are not
written to `localStorage`; this cache threshold is not a collection or sale cap.

After the opening sequence, continuous playback is opt-in and stops on inspection,
navigation away, or a hidden browser tab.
Reduced-motion preferences disable interpolated seeking. The DOM holds only the
current browsing window. Camera scale depends on workspace size rather than fitting
every position: mushrooms stay large, and outer positions may be clipped until
scrolling moves them inward. Their spacing is normalized in screen pixels, so
neighbouring circles retain a wide visual gap at every zoom level while close
camera scales populate the visible turns instead of leaving only a few
small mushrooms at the origin. Positions remain mounted when they cross the edge;
the workspace clips them naturally and scrolling brings them back. The slider
reaches the entire collection and the viewport-sized set of future positions.
Geometry lives in `apps/web/src/spiral-geometry.js`; viewport and browsing state live in
`apps/web/src/mycelium.js`.

## Validation

The retired Sepolia UI and one-off public-transition console remain only in the private development history and are explicitly excluded from public repository exports. Generic local/fork/network rehearsal tooling remains public.

Browser checks require a locally installed Chrome. `test:mint-ux` exercises
navigation, catalog rendering, the mobile viewport matrix and compact landscape,
route/history semantics, artwork downloads and direct-wallet reconnect.
`test:spiral` checks the dedicated mobile Spiral destination and compact geometry.
`test:mint-protection` uses production EVM fixtures.

`test:browser` requires a running local chain, fresh local deployment and local
site. `test:snapshot-startup` instead requires a configured live snapshot with at
least 21 minted positions and a site serving that configuration. See the
[test guide](../../../tests/README.md) for the complete command sequence.
