import { randomBytes } from "node:crypto";

export function generateInboundAliasLocalPart(): string {
  return `m_${randomBytes(20).toString("hex")}`;
}

export function inboundAddress(localPart: string, domain: string): string {
  return `${localPart.toLowerCase()}@${domain.toLowerCase()}`;
}
