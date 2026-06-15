/**
 * Public facade for the Node-level transport probe. Re-exports the
 * stable surface (`probeTransport` / `probeTransportWithDeps` + the
 * result / dependency types) so existing importers keep a single
 * entry point while the implementation lives in the focused modules
 * under `./TransportProbe/` (Url / Dns / Tcp / Tls / Result / Probe).
 *
 * <p>See `./TransportProbe/Probe.js` for the orchestrator and the
 * **MUST CAVEAT** explaining why a Node-side probe only corroborates
 * (never proves) Camoufox connectivity.
 */

export { probeTransport, probeTransportWithDeps } from './TransportProbe/Probe.js';
export type {
  IDnsLookupResult,
  INavTransportProbe,
  IProbeRunInput,
  IProbeTransportInput,
  ITcpHandshakeResult,
  ITransportProbeDeps,
  TransportProbeOutcome,
} from './TransportProbe/Types.js';
