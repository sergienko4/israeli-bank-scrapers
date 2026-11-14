# Device identity

Some banks bind a login to a device identity they expect the official app to
collect. Hapoalim calls it `mfp`; the app builds a RiskMinder device signature
from Android attributes and sends Base64 of it. The pipeline derives an
equivalent identity per user at runtime from the long-term token, with no
bank-specific generator and no device file.

## How it works

A bank declares `deviceIdentity` (`IDeviceIdentityConfig`) on its api-direct
call config and keeps the seed in its carry-bundle warm start:

```typescript
deviceIdentity: {
  credential: 'deviceSignature',
  format: 'risk-minder-mfp',
  seedSlot: 'deviceSeed',
  scopeField: 'userCode',
},
warmStart: {
  kind: 'carry-bundle',
  credsField: 'otpLongTermToken',
  // ...
  slots: ['deviceSeed'],
  cookies: true,
},
seedCarryFromCreds: ['deviceSeed', 'deviceSignature'],
```

`scopeField` selects the HMAC message (for Hapoalim, `userCode`); each user
gets a different signature seed. `seedSlot` names the random seed the
carry-bundle token keeps. The seed is per user and lives in the token; the
token's cookie part may rotate while the seed slot stays unchanged.

`PipelineBuilder.withApiDirect` detects the declaration and attaches the
generic `enrichCredentials` hook. Before the first phase, the provider:

1. validates a non-empty caller credential and uses it instead of the
   generated signature (the override);
2. reads the token's `deviceSeed`; when the token is absent or unusable it
   generates a fresh random seed;
3. derives `signatureSeed = HMAC-SHA256(deviceSeed, scope)`, builds a host
   profile, and asks the format for the signature — the device value is never
   stored;
4. injects the seed and the signature into the credential bag, so the flow
   seeds carry and the carry-bundle export keeps the seed.

The bank config carries only data. The `deviceIdentity` contract lives in
`ConfigContracts/DeviceIdentityTypes.ts`; the implementation is under
`Mediator/ApiDirectCall/DeviceIdentity/`:

| Part                       | Responsibility                                             |
| -------------------------- | ---------------------------------------------------------- |
| `DeviceIdentityProvider`   | Override, token seed, fresh seed and signature order       |
| `DeviceIdentityTypes`      | `IDeviceProfile`, `IDeviceSignatureFormat`                 |
| `HostProfile`              | The host's real facts (`node:os`, first non-internal IPv4) |
| `RISK_MINDER_MFP_FORMAT`   | The vendor JSON schema, registered as `risk-minder-mfp`    |
| `DEVICE_SIGNATURE_FORMATS` | Registry a bank selects from by key                        |

The contracts are `IDeviceIdentityProvider`, `IDeviceSignatureFormat`,
`IDeviceProfile` and `IDeviceNetwork`. `createDeviceIdentityProvider`,
`deviceIdentityEnricherOf` and `readHostProfile` wire the production adapters;
`CredentialEnricher` is the builder seam they fill. The token codec is
`decodeWarmBundle` from `Flow/WarmCarryBundle.ts`.

## Adding another bank

Add a `deviceIdentity` block and the seed slot to the bank's carry-bundle warm
start, then reuse a registered format or register a new
`IDeviceSignatureFormat` adapter and select its key. No Core or phase change is
required. The format owns the vendor schema; the provider owns the seed and
ordering. A format is pure given a host profile and a seed.

## First run and security

A new identity is an unknown device to the bank, so the first login spends the
bank's normal device-challenge OTP (two for Hapoalim: login and device
step-up). The returned `otpLongTermToken` carries the seed; after enrolment the
same user and token derive the same identity and land without SMS. A lost
token means a fresh seed and two SMS; there is no public derivation fallback —
`HMAC(userCode, userCode)` is not a secret and would let anyone with the user
code compute the device. The token is per user, so a multi-tenant host never
shares one device identity across users. A caller may override the derived
identity with the configured credential, which is also the path for CI when a
pre-enrolled identity is supplied as a secret.
