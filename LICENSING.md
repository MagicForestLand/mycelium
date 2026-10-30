# Licensing and third-party notices

| Material | License |
| --- | --- |
| Original artwork, catalog data, frontend, documentation, tests and tooling outside `contracts/` | [CC0 1.0 Universal](LICENSE) |
| Solidity source files in `contracts/`, including generated Solidity | [MIT](contracts/LICENSE) |
| Third-party dependencies and incorporated third-party interfaces | Their respective upstream licenses |

Every Solidity source carries `SPDX-License-Identifier: MIT`. Generated Solidity stays under the `contracts/` MIT scope. Generated artifacts under `apps/web/` and elsewhere outside `contracts/` follow the CC0 scope of their canonical original inputs unless they contain third-party material governed by its own license.

Dependencies are not relicensed by this repository. The authoritative installed dependency graph and versions are in `package-lock.json`; npm packages include their own license metadata and legal files. Material dependencies include OpenZeppelin Contracts, ethers, Reown AppKit, esbuild, solc, Puppeteer Core and Ganache. `ICreatorToken.sol` implements interfaces associated with the Limit Break creator-token standard; consult its upstream repository and notices when redistributing or modifying third-party-derived material.

## Material runtime and verification dependencies

| Dependency | Pinned version | License in the installed package | Distribution note |
| --- | ---: | --- | --- |
| Reown AppKit / ethers adapter | `1.8.24` | Reown Community License Agreement | Static site exports include `reown-community-license.txt` and display the required notice: “Portions © 2025 Reown, Inc. All Rights Reserved”. The pinned license also defines RPC/MAU thresholds for commercial licensing; review them before a launch expected to cross those thresholds. |
| ethers | `6.17.0` | MIT | Browser wallet and Ethereum integration. |
| OpenZeppelin Contracts | `5.4.0` | MIT | Solidity library source and interfaces. |
| axe-core | `4.14.0` | MPL-2.0 | Test-only accessibility engine. |
| Puppeteer Core | `25.16.0` | Apache-2.0 | Test-only browser automation. |
| esbuild / solc / Ganache | `0.28.2` / `0.8.37` / `7.9.2` | MIT | Build, compiler and local-chain tooling. |

The generated static-site manifest hashes the exported Reown license copy along
with every other public file. The exporter reads it from the pinned installed
package instead of maintaining a divergent handwritten copy.

This matrix documents repository scope; it does not replace any third-party license text.
