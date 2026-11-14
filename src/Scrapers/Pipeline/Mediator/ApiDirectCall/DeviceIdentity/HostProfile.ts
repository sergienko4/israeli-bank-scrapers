/**
 * Host device profile — the real host facts a signature format may use. It is
 * an adapter, so formats and tests never call `node:os` themselves.
 */

import os from 'node:os';

import type { IDeviceNetwork, IDeviceProfile } from './DeviceIdentityTypes.js';

/** Neutral user agent the generated signature carries. */
const NODE_USER_AGENT = 'Dalvik 2.1.0 (Linux; U; Android 14; node)';

/** The profile fields that are not network facts. */
type IHostFacts = Omit<IDeviceProfile, 'network'>;

/** Loopback defaults when the host has no non-internal IPv4 interface. */
const DEFAULT_NETWORK: IDeviceNetwork = {
  ipAddress: '127.0.0.1',
  netmaskAddress: '255.0.0.0',
  macAddress: '00:00:00:00:00:00',
  gatewayAddress: '127.0.0.1',
  broadcastAddress: '127.255.255.255',
};

/**
 * The first non-internal IPv4 interface.
 * @returns The interface, or false when none exists.
 */
function firstIpv4(): os.NetworkInterfaceInfo | false {
  const interfaces = os.networkInterfaces();
  const all = Object.values(interfaces).flatMap(list => list ?? []);
  return all.find(item => item.family === 'IPv4' && !item.internal) ?? false;
}

/**
 * The octets of a dotted IPv4 address.
 * @param address - Dotted IPv4 address.
 * @returns Its four numeric octets.
 */
function octetsOf(address: string): readonly number[] {
  return address.split('.').map(Number);
}

/** The network and broadcast addresses one interface mask defines. */
interface INetworkBounds {
  readonly network: string;
  readonly broadcast: string;
}

/**
 * The network and broadcast addresses a host and its mask define.
 * @param address - Dotted host address.
 * @param netmask - Dotted interface mask.
 * @returns The network prefix and the broadcast address.
 */
function boundsOf(address: string, netmask: string): INetworkBounds {
  const ip = octetsOf(address);
  const mask = octetsOf(netmask);
  const network = ip.map((octet, index) => octet & (mask[index] ?? 0));
  const broadcast = ip.map((octet, index) => octet | (~(mask[index] ?? 0) & 255));
  return { network: network.join('.'), broadcast: broadcast.join('.') };
}

/**
 * The first host on a network prefix, or `0.0.0.0` when the mask leaves no
 * host bit to address (/31 and /32 interfaces have no inferred gateway).
 * @param network - Dotted network address.
 * @param netmask - Dotted interface mask.
 * @returns The inferred gateway or the explicit unknown.
 */
function gatewayOf(network: string, netmask: string): string {
  const prefixLength = octetsOf(netmask).reduce(
    (total, octet) => total + octet.toString(2).replaceAll('0', '').length,
    0,
  );
  if (prefixLength >= 31) return '0.0.0.0';
  const [a, b, c, d] = octetsOf(network);
  return [String(a), String(b), String(c), String(d + 1)].join('.');
}

/**
 * Map one IPv4 interface into the signature's network facts.
 * @param item - The host interface.
 * @returns Its address, netmask, MAC and derived gateway/broadcast.
 */
function networkFrom(item: os.NetworkInterfaceInfo): IDeviceNetwork {
  const bounds = boundsOf(item.address, item.netmask);
  return {
    ipAddress: item.address,
    netmaskAddress: item.netmask,
    macAddress: item.mac,
    gatewayAddress: gatewayOf(bounds.network, item.netmask),
    broadcastAddress: bounds.broadcast,
  };
}

/**
 * The host's network facts, or loopback defaults.
 * @returns The network block.
 */
function networkOf(): IDeviceNetwork {
  const item = firstIpv4();
  return item === false ? DEFAULT_NETWORK : networkFrom(item);
}

/**
 * Machine identity facts from the CPU list.
 * @param cpus - `os.cpus()`.
 * @returns Host name, platform, architecture and CPU facts.
 */
function machineIdentityOf(
  cpus: os.CpuInfo[],
): Pick<IHostFacts, 'hostName' | 'platform' | 'arch' | 'cpuModel' | 'cpuCount'> {
  const host = { hostName: os.hostname(), platform: process.platform, arch: os.arch() };
  const cpu = { cpuModel: cpus[0]?.model ?? os.arch(), cpuCount: cpus.length };
  return { ...host, ...cpu };
}

/**
 * Machine memory fact.
 * @returns Total memory in bytes.
 */
function machineMemoryOf(): Pick<IHostFacts, 'totalMemory'> {
  return { totalMemory: os.totalmem() };
}

/**
 * Machine facts from the CPU list.
 * @param cpus - `os.cpus()`.
 * @returns Host name, platform, architecture, CPU and memory facts.
 */
function machineOf(
  cpus: os.CpuInfo[],
): Pick<IHostFacts, 'hostName' | 'platform' | 'arch' | 'cpuModel' | 'cpuCount' | 'totalMemory'> {
  const identity = machineIdentityOf(cpus);
  const memory = machineMemoryOf();
  return { ...identity, ...memory };
}

/**
 * Locale facts from the resolved options.
 * @param resolved - `Intl.DateTimeFormat().resolvedOptions()`.
 * @returns Locale, time zone and the neutral user agent.
 */
function localeOf(
  resolved: Intl.ResolvedDateTimeFormatOptions,
): Pick<IHostFacts, 'locale' | 'timeZone' | 'userAgent'> {
  return { locale: resolved.locale, timeZone: resolved.timeZone, userAgent: NODE_USER_AGENT };
}

/**
 * Read the host facts once per enrichment.
 * @returns Immutable host profile.
 */
function readHostProfile(): IDeviceProfile {
  const cpus = os.cpus();
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return { ...machineOf(cpus), ...localeOf(resolved), network: networkOf() };
}

export default readHostProfile;
