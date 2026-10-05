export interface PlannerTicket {
    id: string;
    status: string;
    blockedBy: string[];
}
export interface DependencyPlan {
    waves: PlannerTicket[][];
    cycles: string[];
}
export declare class DependencyPlannerService {
    plan(tickets: PlannerTicket[]): DependencyPlan;
}
