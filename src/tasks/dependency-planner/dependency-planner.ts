export interface PlannerTicket {
  id: string
  status: string
  blockedBy: string[]
}

export interface DependencyPlan {
  waves: PlannerTicket[][]
  cycles: string[]
}

export class DependencyPlannerService {
  plan(tickets: PlannerTicket[]): DependencyPlan {
    const byId = new Map(tickets.map((t) => [t.id, t]))
    const isOpen = (t: PlannerTicket): boolean => t.status !== 'closed'
    const openTickets = tickets.filter(isOpen)

    const waveOf = new Map<string, number>()
    const failed = new Set<string>()
    const visiting = new Set<string>()

    const computeWave = (id: string): number | null => {
      if (failed.has(id)) return null
      if (waveOf.has(id)) return waveOf.get(id) ?? null
      const ticket = byId.get(id)
      if (ticket === undefined || !isOpen(ticket)) return -1
      if (visiting.has(id)) return null
      visiting.add(id)
      const blockerWaves = ticket.blockedBy.map(computeWave)
      visiting.delete(id)
      if (blockerWaves.some((w) => w === null)) {
        failed.add(id)
        return null
      }
      const wave = Math.max(-1, ...blockerWaves.filter((w): w is number => w !== null)) + 1
      waveOf.set(id, wave)
      return wave
    }

    openTickets.forEach((t) => computeWave(t.id))

    const scheduled = openTickets.filter((t) => waveOf.has(t.id))
    const cycles = openTickets.filter((t) => !waveOf.has(t.id)).map((t) => t.id)

    const maxWave = scheduled.reduce((max, t) => Math.max(max, waveOf.get(t.id) ?? 0), -1)
    const waves = Array.from({ length: maxWave + 1 }, (_, i) =>
      scheduled.filter((t) => waveOf.get(t.id) === i),
    )

    return { waves, cycles }
  }
}
