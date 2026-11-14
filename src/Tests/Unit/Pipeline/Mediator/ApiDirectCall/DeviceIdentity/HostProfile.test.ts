/**
 * Host profile — the network facts a generated device signature sends. The
 * gateway and broadcast must follow the interface's real mask, not assume a
 * /24; a host with no non-internal IPv4 falls back to loopback defaults.
 */

import os from 'node:os';

import { jest } from '@jest/globals';

import readHostProfile from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceIdentity/HostProfile.js';

/**
 * One synthetic IPv4 interface.
 * @returns The interface facts.
 */
function ipv4Interface(): os.NetworkInterfaceInfo {
  return {
    address: '172.17.0.2',
    netmask: '255.255.0.0',
    family: 'IPv4',
    mac: '02:00:00:00:00:01',
    internal: false,
    cidr: '172.17.0.2/16',
  };
}

describe('host profile network facts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives the gateway and broadcast from a non-/24 mask', () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue({ eth0: [ipv4Interface()] });
    const profile = readHostProfile();
    expect(profile.network.gatewayAddress).toBe('172.17.0.1');
    expect(profile.network.broadcastAddress).toBe('172.17.255.255');
    expect(profile.network.netmaskAddress).toBe('255.255.0.0');
  });

  it('uses loopback defaults when no non-internal IPv4 interface exists', () => {
    jest.spyOn(os, 'networkInterfaces').mockReturnValue({});
    const profile = readHostProfile();
    expect(profile.network.ipAddress).toBe('127.0.0.1');
    expect(profile.network.broadcastAddress).toBe('127.255.255.255');
  });
});
