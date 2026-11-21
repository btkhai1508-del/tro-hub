/**
 * Keeps a slow read response from overwriting something the user just saved.
 * A read is accepted only if no write began or ended since it started, none is running,
 * and no newer read has already been accepted (the newest read wins).
 */
export function createWriteGuard() {
  let readSeq = 0;
  let writeEvents = 0;
  let activeWrites = 0;
  let lastAccepted = 0;
  const startedAt = new Map<number, number>();

  return {
    beginRead(): number {
      const ticket = ++readSeq;
      startedAt.set(ticket, writeEvents);
      return ticket;
    },
    acceptRead(ticket: number): boolean {
      const events = startedAt.get(ticket);
      startedAt.delete(ticket);
      if (events === undefined) return false;
      if (activeWrites > 0 || events !== writeEvents) return false;
      if (ticket < lastAccepted) return false;
      lastAccepted = ticket;
      return true;
    },
    beginWrite(): void {
      activeWrites++;
      writeEvents++;
    },
    endWrite(): void {
      activeWrites = Math.max(0, activeWrites - 1);
      writeEvents++;
    },
  };
}
