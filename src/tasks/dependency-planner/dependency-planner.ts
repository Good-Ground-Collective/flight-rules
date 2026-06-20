export interface PlannerTicket {
  id: string
  status: string
  blockedBy: string[]
}

export interface DependencyPlan {
  waves: PlannerTicket[][]
  cycles: string[]
}

export function planDependencies(tickets: PlannerTicket[]): DependencyPlan {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const isOpen = (ticket: PlannerTicket): boolean => ticket.status !== 'closed'

  const isSatisfied = (blockerId: string): boolean => {
    const blocker = byId.get(blockerId)
    return blocker === undefined || !isOpen(blocker)
  }

  const openTickets = tickets.filter(isOpen)
  const placed = new Set<string>()
  const waves: PlannerTicket[][] = []

  for (;;) {
    const wave = openTickets.filter(
      (ticket) =>
        !placed.has(ticket.id) &&
        ticket.blockedBy.every((blocker) => isSatisfied(blocker) || placed.has(blocker)),
    )
    if (wave.length === 0) break
    for (const ticket of wave) placed.add(ticket.id)
    waves.push(wave)
  }

  const cycles = openTickets.filter((ticket) => !placed.has(ticket.id)).map((ticket) => ticket.id)

  return { waves, cycles }
}
