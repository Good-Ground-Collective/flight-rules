export interface PlannerTicket {
    id: string;
    status: string;
    blockedBy: string[];
    /** Set by initiative plans, so a caller can work one epic at a time. */
    epicId?: string;
}
export interface DependencyPlan {
    waves: PlannerTicket[][];
    cycles: string[];
}
export declare class DependencyPlannerService {
    plan(tickets: PlannerTicket[]): DependencyPlan;
}
