/**
 * A two-player link with "latest state" semantics: each side keeps publishing its current
 * state object and reads the other side's most recent one. That fits every transport:
 *
 * - room:  claude.ai's real-time room capability (a named room per session code; state
 *          rides on presence, which any viewer may set). Used when the game runs as a
 *          claude.ai artifact.
 * - peer:  WebRTC through the public PeerJS broker. Used when the game is self-hosted.
 * - local: BroadcastChannel between tabs of one browser, for development and tests.
 */

export type Role = 'host' | 'guest';
export type Via = 'room' | 'peer' | 'local';

export interface Channel {
  readonly role: Role;
  readonly code: string;
  readonly via: Via;
  /** Publish this side's current state. Callers throttle (~20 Hz). */
  send(state: unknown): void;
  /** The other side's latest state. */
  onState(fn: (state: unknown) => void): void;
  /** Whether the partner is connected; fires on every change. */
  onPartner(fn: (present: boolean) => void): void;
  close(): void;
}

export class NetError extends Error {}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_LEN = 5;

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (!CODE_CHARS.includes(ch)) return null;
  return c;
}

const params = new URLSearchParams(location.search);

/** Which transport this copy of the game uses. */
export function detectVia(): Via {
  const forced = params.get('net');
  if (forced === 'local' || forced === 'peer' || forced === 'room') return forced;
  // Inside a claude.ai viewer the page gets a `window.claude` with `use()`.
  return typeof (window as { claude?: { use?: unknown } }).claude?.use === 'function' ? 'room' : 'peer';
}

export async function openChannel(role: Role, code: string): Promise<Channel> {
  const via = detectVia();
  if (via === 'room') return roomChannel(role, code);
  if (via === 'local') return localChannel(role, code);
  return peerChannel(role, code);
}

const other = (r: Role): Role => (r === 'host' ? 'guest' : 'host');
const JOIN_TIMEOUT = 8000;

// ---------------------------------------------------------------------------------------
// claude.ai room

/** The slice of the room capability this game uses. */
interface RoomPeer {
  sameTab: boolean;
  presence: Readonly<Record<string, unknown>>;
}
interface NamedRoom {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  onPeers(fn: (c: { peers: readonly RoomPeer[]; joined: readonly RoomPeer[]; updated: readonly RoomPeer[] }) => void, onError?: (e: { code: string }) => void): () => void;
  leave(): Promise<void>;
}
interface RoomCap {
  join(name: string): Promise<NamedRoom>;
}

async function roomChannel(role: Role, code: string): Promise<Channel> {
  const claude = (window as unknown as { claude: { use(name: 'room'): Promise<RoomCap | null> } }).claude;
  const room = await claude.use('room');
  if (!room) throw new NetError('Co-op needs you to be signed in to claude.ai with access to this page.');

  let r: NamedRoom;
  try {
    r = await room.join(`nr-${code.toLowerCase()}`);
  } catch (e) {
    const c = (e as { code?: string }).code;
    throw new NetError(c === 'not_permitted' ? 'Co-op rooms are not available for this page.' : 'Could not reach the co-op server. Try again.');
  }
  await r.presence({ role });

  let stateFn: ((s: unknown) => void) | null = null;
  let partnerFn: ((p: boolean) => void) | null = null;
  let present = false;
  let lastState: unknown = undefined;

  const isPartner = (p: RoomPeer) => !p.sameTab && p.presence.role === other(role);
  const unsubscribe = r.onPeers((change) => {
    for (const p of [...change.joined, ...change.updated]) {
      if (isPartner(p) && p.presence.s !== undefined && p.presence.s !== lastState) {
        lastState = p.presence.s;
        stateFn?.(p.presence.s);
      }
    }
    const now = change.peers.some(isPartner);
    if (now !== present) {
      present = now;
      partnerFn?.(present);
    }
  });

  if (role === 'guest') await waitFor(() => present, 'No game found with that code. Check it and try again.');

  return {
    role,
    code,
    via: 'room',
    send: (s) => void r.presence({ role, s }).catch(() => {}),
    onState: (fn) => (stateFn = fn),
    onPartner: (fn) => {
      partnerFn = fn;
      fn(present);
    },
    close: () => {
      unsubscribe();
      void r.leave().catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------------------
// PeerJS (WebRTC)

type DataConnection = import('peerjs').DataConnection;
type PeerOptions = import('peerjs').PeerOptions;

function peerOptions(): PeerOptions {
  // ?peerserver=host:port points at a self-run PeerJS server (used by the tests).
  const custom = params.get('peerserver');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:', debug: 0 };
}

async function peerChannel(role: Role, code: string): Promise<Channel> {
  const { Peer } = await import('peerjs');
  const hostId = `neonrunner-${code.toLowerCase()}`;
  const peer = role === 'host' ? new Peer(hostId, peerOptions()) : new Peer(peerOptions());

  await new Promise<void>((resolve, reject) => {
    peer.once('open', () => resolve());
    peer.once('error', (e) =>
      reject(
        new NetError(
          (e as { type?: string }).type === 'unavailable-id'
            ? 'That code is already in use. Try hosting again.'
            : 'Could not reach the matchmaking server. Check your connection.',
        ),
      ),
    );
    setTimeout(() => reject(new NetError('Could not reach the matchmaking server. Check your connection.')), JOIN_TIMEOUT);
  });

  let conn: DataConnection | null = null;
  let stateFn: ((s: unknown) => void) | null = null;
  let partnerFn: ((p: boolean) => void) | null = null;
  let present = false;
  const setPresent = (v: boolean) => {
    if (v === present) return;
    present = v;
    partnerFn?.(v);
  };
  const attach = (c: DataConnection) => {
    conn = c;
    c.on('data', (d) => stateFn?.(d));
    c.on('open', () => setPresent(true));
    c.on('close', () => {
      if (conn === c) conn = null;
      setPresent(false);
    });
    c.on('error', () => setPresent(false));
    if (c.open) setPresent(true);
  };

  if (role === 'host') {
    peer.on('connection', (c) => {
      // One guest at a time; a second one is turned away.
      if (conn?.open) {
        c.on('open', () => c.close());
        return;
      }
      attach(c);
    });
  } else {
    const c = peer.connect(hostId, { serialization: 'json', reliable: true });
    attach(c);
    await new Promise<void>((resolve, reject) => {
      c.once('open', () => resolve());
      peer.once('error', (e) =>
        reject(
          new NetError(
            (e as { type?: string }).type === 'peer-unavailable'
              ? 'No game found with that code. Check it and try again.'
              : 'Could not connect to your friend. Their network may block direct connections.',
          ),
        ),
      );
      setTimeout(() => reject(new NetError('No game found with that code. Check it and try again.')), JOIN_TIMEOUT);
    });
  }

  return {
    role,
    code,
    via: 'peer',
    send: (s) => {
      if (conn?.open) void conn.send(s);
    },
    onState: (fn) => (stateFn = fn),
    onPartner: (fn) => {
      partnerFn = fn;
      fn(present);
    },
    close: () => {
      conn?.close();
      peer.destroy();
    },
  };
}

// ---------------------------------------------------------------------------------------
// BroadcastChannel (same browser, for development)

async function localChannel(role: Role, code: string): Promise<Channel> {
  const bc = new BroadcastChannel(`nr-${code}`);
  let stateFn: ((s: unknown) => void) | null = null;
  let partnerFn: ((p: boolean) => void) | null = null;
  let present = false;
  let lastSeen = 0;
  const setPresent = (v: boolean) => {
    if (v === present) return;
    present = v;
    partnerFn?.(v);
  };
  bc.onmessage = (ev) => {
    const m = ev.data as { role: Role; s?: unknown; bye?: boolean };
    if (m.role !== other(role)) return;
    if (m.bye) return setPresent(false);
    lastSeen = performance.now();
    setPresent(true);
    if (m.s !== undefined) stateFn?.(m.s);
  };
  const beat = window.setInterval(() => {
    bc.postMessage({ role });
    if (present && performance.now() - lastSeen > 8000) setPresent(false);
  }, 400);
  bc.postMessage({ role });

  if (role === 'guest') {
    try {
      await waitFor(() => present, 'No game found with that code. Check it and try again.');
    } catch (e) {
      clearInterval(beat);
      bc.close();
      throw e;
    }
  }

  return {
    role,
    code,
    via: 'local',
    send: (s) => bc.postMessage({ role, s }),
    onState: (fn) => (stateFn = fn),
    onPartner: (fn) => {
      partnerFn = fn;
      fn(present);
    },
    close: () => {
      bc.postMessage({ role, bye: true });
      clearInterval(beat);
      bc.close();
    },
  };
}

function waitFor(cond: () => boolean, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const id = window.setInterval(() => {
      if (cond()) {
        clearInterval(id);
        resolve();
      } else if (performance.now() - start > JOIN_TIMEOUT) {
        clearInterval(id);
        reject(new NetError(message));
      }
    }, 100);
  });
}
