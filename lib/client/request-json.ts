import { readApiErrorMessage } from "@/lib/client/api-guards";

export type JsonResponsePacket = {
  response: Response;
  raw: unknown;
};

export async function requestJson(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<JsonResponsePacket> {
  const response = await fetch(input, init);
  const raw = await response.json().catch(() => null);
  return { response, raw };
}

type ParseOptions<T, TOk extends T> = {
  isOk?: (parsed: T) => parsed is TOk;
  getError?: (ctx: { parsed: T | null; raw: unknown; response: Response }) => string;
};

export function parseJsonOrThrow<T, TOk extends T = T>(
  packet: JsonResponsePacket,
  parse: (raw: unknown) => T | null,
  opts?: ParseOptions<T, TOk>,
): TOk {
  const parsed = parse(packet.raw);
  const okByType = parsed && opts?.isOk ? opts.isOk(parsed) : Boolean(parsed);
  const ok = packet.response.ok && okByType;

  if (!ok) {
    const custom = opts?.getError?.({
      parsed,
      raw: packet.raw,
      response: packet.response,
    });
    const fallback = readApiErrorMessage(parsed ?? packet.raw) || `HTTP ${packet.response.status}`;
    throw new Error(custom || fallback);
  }

  return parsed as TOk;
}

export async function requestJsonOrThrow<T, TOk extends T = T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  parse: (raw: unknown) => T | null,
  opts?: ParseOptions<T, TOk>,
): Promise<TOk> {
  const packet = await requestJson(input, init);
  return parseJsonOrThrow(packet, parse, opts);
}
