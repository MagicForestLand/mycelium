# Ledger signing procedure for a mainnet deployment

This is the only supported production signing path. It signs one manifest-bound CREATE transaction and writes a raw signed transaction **without broadcasting it**. The subsequent broadcast remains a separate command and decision.

For each deployment, freeze the deployer address, derivation path, release
manifest and independently approved digest before using this procedure. Rehearse
the physical signing flow with an isolated test-chain transaction first.

## Fixed tool

The version below is an intentional reproducibility pin, not a claim about the
latest Foundry release. A change to the signing tool requires fresh review and
matching validation-policy changes.

The adapter accepts only Foundry `cast` v1.7.1 at commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`. For macOS ARM64 the official release archive and recorded digest are:

```text
https://github.com/foundry-rs/foundry/releases/download/v1.7.1/foundry_v1.7.1_darwin_arm64.tar.gz
SHA-256 eacdc67718fac857cad9e19c7f6729dd80de731d09df81856391d093cfcab547
```

Download from the official Foundry release, verify the digest before extraction, and keep the resolved `cast` binary path in the release record. The signing script also verifies the embedded version and commit before it asks the Ledger to sign.

## Wallet preparation

1. Initialize the dedicated Ledger from the hardware device. Keep the recovery phrase offline; never enter it in MetaMask, Ledger Wallet, this repository, a terminal or the signing computer.
2. Install/update the official Ethereum app. Record the exact device model, Ledger OS and Ethereum app version in the external release evidence.
3. Choose and freeze an explicit derivation path, for example `m/44'/60'/0'/0/0`. The example is not an address assignment: the address derived on the actual device is authoritative.
4. In Ledger Wallet, use the Ethereum account's Receive flow and verify the complete deployer address on the hardware screen. Compare it character-for-character with the production config and with the output derived by `cast` from the same path.
5. Close Ledger Wallet before using `cast` so it does not retain the USB connection. Open the Ethereum app on the device.
6. Contract creation may require Blind signing. Enable it only immediately before the reviewed signing session and disable it afterwards. Leave Smart account upgrade/EIP-7702 disabled; the deployment uses an ordinary type-2 EOA transaction.

Consult [Ledger's Ethereum instructions](https://support.ledger.com/article/360009576554-zd)
for the device and app version in use. Recheck its Blind signing setting after
an OS or app update before beginning a reviewed session.

## One deployment step

First generate the next unsigned intent with the read-only command in [RELEASE.md](../../../repository/release/RELEASE.md). Independently compare at least:

- approved release digest and intent digest;
- chain ID `1`, transaction type `2`, expected Ledger address and nonce;
- CREATE (`to: null`), value `0`, expected contract address;
- initcode hash, gas limit, max fee and priority fee;
- current journal contains no unresolved different transaction.

Then sign it:

```sh
npm run release:ledger-sign -- \
  /absolute/external/release/manifest.json \
  /absolute/external/next-intent.json \
  --expected-release APPROVED_SHA256 \
  --derivation-path "m/44'/60'/0'/0/0" \
  --cast /absolute/path/to/pinned/foundry/cast \
  --output /absolute/external/signed-transaction.json
```

Before touching the device, the adapter reconstructs the intent from the approved manifest. It refuses a changed intent, an unexpected Foundry build or a Ledger address different from the manifest deployer. It supplies every transaction field explicitly and removes software-key, keystore, KMS and RPC signer variables from the child process environment.

On the Ledger, read every available screen and reject unexpected chain, fee, value or warning. CREATE initcode cannot be meaningfully reviewed on the small device display; that is why the adapter independently decodes the resulting signature and compares its complete unsigned serialization with the reviewed intent. A successful command writes a mode-`0600` JSON file with status `SIGNED_NOT_BROADCAST` and prints `NOT BROADCAST`.

Do not copy the raw transaction into chat, cloud notes or the repository. Store it beside the external journal. Disable Blind signing after the signing session.

## Separate broadcast gate

Signing is not authorization to publish. Only after the signed JSON, current nonce/fees, complete graph budget and explicit deployment decision are rechecked may the operator pass that file to `release:mainnet -- broadcast` as documented in [RELEASE.md](../../../repository/release/RELEASE.md). That command decodes the transaction again, persists it in the durable journal, and only then can call `eth_sendRawTransaction`.

If signing fails or any value differs, reject on the device and stop. Do not change nonce, data, gas or fee fields by hand. Generate a new reviewed manifest/intent when an approved field must change.
