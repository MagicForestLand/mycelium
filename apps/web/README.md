# Browser application

`index.html` and `assets/` are the authored application shell and styles. `src/` contains chain reads, wallet integration, mint protection/recovery, UI, pricing display, marketplace links and spiral browsing. Canonical artwork, metadata and editorial are imported from [collection/](../../collection/README.md), never duplicated here.

Commands run from the repository root:

```sh
npm ci
cp apps/web/config/chain-config.example.json apps/web/chain-config.json
npm run build
npm start
```

Open <http://127.0.0.1:4173/>. The example configuration supports exploring the
artwork without a connected chain. To test minting, keep `npm run local:chain`
running in another terminal, run `npm run local:deploy`, then reload the site.

## Build output and runtime configuration

`mycelium.bundle.js` and `assets/web3/` are ignored generated bundles. `chain-config.json` is ignored local runtime configuration, also produced by `npm run local:deploy`. The local server maps conventional site URLs to this source directory.

## Mainnet export

Mainnet staging uses the explicit wallet-disabled `config/mainnet-staging-site.json`;
production uses the strict wallet-enabled `config/mainnet-site.json`. Both derive
deployment identity from the verified `deployments/core/ethereum/mainnet.json`.
Run either profile explicitly:

```sh
npm run export:site -- deployments/core/ethereum/mainnet.json apps/web/config/mainnet-staging-site.json
npm run export:site -- deployments/core/ethereum/mainnet.json apps/web/config/mainnet-site.json
```

The read-only profile omits Reown settings and wallet chunks, disables wallet and
mint controls, and still reads the exact mainnet deployment through the reviewed
snapshot API and browser-safe RPC. The production profile fails closed until its
final Reown project and reviewed public settings are present. Render serves the
resulting ignored `output/site/`: `/index.html`, `/assets/…`,
`/chain-config.json` and `/output/branding/…`, never `/apps/web/…`. No private
source tree or local config is published.

See [frontend architecture](../../docs/apps/web/ARCHITECTURE.md) for the snapshot/RPC authority model and wallet boundaries; [minting](../../docs/contracts/core/architecture/MINTING.md) for the protocol and recovery behavior; and the [test guide](../../tests/README.md) for browser checks.
