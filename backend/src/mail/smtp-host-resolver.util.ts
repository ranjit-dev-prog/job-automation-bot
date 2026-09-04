import { lookup } from 'node:dns/promises';

/**
 * nodemailer resolves SMTP hostnames via dns.Resolver().resolve4/resolve6 (raw c-ares UDP
 * queries) before ever falling back to the OS-level dns.lookup(). On networks where that UDP
 * path is slow or blocked but normal OS resolution works fine, this makes every send hang for
 * ~2 minutes before it falls through. Resolving via dns.lookup() ourselves and connecting to the
 * IP directly (with `servername` set for TLS/SNI) sidesteps nodemailer's slow path entirely.
 */
export async function resolveSmtpHost(hostname: string): Promise<{ host: string; servername: string }> {
  try {
    // Force IPv4: a literal IP handed to nodemailer skips Node's automatic dual-stack fallback
    // (autoSelectFamily), so if dns.lookup() picked an unreachable IPv6 address on a network with
    // broken IPv6 routing, the connection would hang with no fallback. IPv4 is the safer default
    // here since Gmail's SMTP endpoints are always dual-stack.
    const { address } = await lookup(hostname, { family: 4 });
    return { host: address, servername: hostname };
  } catch {
    return { host: hostname, servername: hostname };
  }
}
