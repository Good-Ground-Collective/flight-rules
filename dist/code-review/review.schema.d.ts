import { z } from "zod";
/** The v1 wire contract is shared with Actions; snake_case is intentionally preserved at this boundary. */
export declare const reviewContractVersion = 1;
export declare const reviewSchemaRevision = 1;
export declare const ReviewOutcomeSchema: z.ZodEnum<{
    APPROVED: "APPROVED";
    CHANGES_NEEDED: "CHANGES_NEEDED";
    ESCALATE: "ESCALATE";
    INCOMPLETE: "INCOMPLETE";
}>;
export declare const FindingIdSchema: z.ZodString;
export declare const HeadShaSchema: z.ZodString;
export declare const ReviewPathSchema: z.ZodString;
export declare const NewFindingSchema: z.ZodUnion<readonly [z.ZodObject<{
    label: z.ZodEnum<{
        chore: "chore";
        question: "question";
        issue: "issue";
        todo: "todo";
        suggestion: "suggestion";
        nitpick: "nitpick";
        typo: "typo";
        polish: "polish";
    }>;
    type: z.ZodEnum<{
        fix: "fix";
        clarify: "clarify";
    }>;
    blocking: z.ZodBoolean;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        trivial: "trivial";
    }>;
    details: z.ZodString;
    resolved_when: z.ZodString;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"decide">;
    decision_owner: z.ZodString;
    decision_options: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
    }, z.core.$strict>>;
    label: z.ZodEnum<{
        chore: "chore";
        question: "question";
        issue: "issue";
        todo: "todo";
        suggestion: "suggestion";
        nitpick: "nitpick";
        typo: "typo";
        polish: "polish";
    }>;
    blocking: z.ZodBoolean;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        trivial: "trivial";
    }>;
    details: z.ZodString;
    resolved_when: z.ZodString;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    label: z.ZodEnum<{
        note: "note";
        praise: "praise";
        thought: "thought";
    }>;
    blocking: z.ZodLiteral<false>;
    details: z.ZodOptional<z.ZodString>;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>]>;
export declare const ActionableFindingSchema: z.ZodUnion<readonly [z.ZodObject<{
    id: z.ZodString;
    label: z.ZodEnum<{
        chore: "chore";
        question: "question";
        issue: "issue";
        todo: "todo";
        suggestion: "suggestion";
        nitpick: "nitpick";
        typo: "typo";
        polish: "polish";
    }>;
    type: z.ZodEnum<{
        fix: "fix";
        clarify: "clarify";
    }>;
    blocking: z.ZodBoolean;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        trivial: "trivial";
    }>;
    details: z.ZodString;
    resolved_when: z.ZodString;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"decide">;
    decision_owner: z.ZodString;
    decision_options: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
    }, z.core.$strict>>;
    label: z.ZodEnum<{
        chore: "chore";
        question: "question";
        issue: "issue";
        todo: "todo";
        suggestion: "suggestion";
        nitpick: "nitpick";
        typo: "typo";
        polish: "polish";
    }>;
    blocking: z.ZodBoolean;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        trivial: "trivial";
    }>;
    details: z.ZodString;
    resolved_when: z.ZodString;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>]>;
export declare const StoredFindingSchema: z.ZodUnion<readonly [z.ZodObject<{
    id: z.ZodString;
    label: z.ZodEnum<{
        chore: "chore";
        question: "question";
        issue: "issue";
        todo: "todo";
        suggestion: "suggestion";
        nitpick: "nitpick";
        typo: "typo";
        polish: "polish";
    }>;
    type: z.ZodEnum<{
        fix: "fix";
        clarify: "clarify";
    }>;
    blocking: z.ZodBoolean;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        trivial: "trivial";
    }>;
    details: z.ZodString;
    resolved_when: z.ZodString;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"decide">;
    decision_owner: z.ZodString;
    decision_options: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
    }, z.core.$strict>>;
    label: z.ZodEnum<{
        chore: "chore";
        question: "question";
        issue: "issue";
        todo: "todo";
        suggestion: "suggestion";
        nitpick: "nitpick";
        typo: "typo";
        polish: "polish";
    }>;
    blocking: z.ZodBoolean;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        trivial: "trivial";
    }>;
    details: z.ZodString;
    resolved_when: z.ZodString;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    label: z.ZodEnum<{
        note: "note";
        praise: "praise";
        thought: "thought";
    }>;
    blocking: z.ZodLiteral<false>;
    details: z.ZodOptional<z.ZodString>;
    path: z.ZodString;
    line: z.ZodNumber;
    start_line: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodEnum<{
        docs: "docs";
        data: "data";
        deployment: "deployment";
        security: "security";
        correctness: "correctness";
        design: "design";
        testing: "testing";
        performance: "performance";
        readability: "readability";
    }>>;
    subject: z.ZodString;
    discussion: z.ZodString;
    related_finding_id: z.ZodOptional<z.ZodString>;
}, z.core.$strict>]>;
export declare const ReviewEvidenceSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"github_comment">;
    comment_id: z.ZodNumber;
    url: z.ZodURL;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"code">;
    commit_sha: z.ZodString;
    path: z.ZodString;
    line: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"commit">;
    sha: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"check_run">;
    check_run_id: z.ZodNumber;
    commit_sha: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"document">;
    url: z.ZodURL;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"verification">;
    commit_sha: z.ZodString;
    command: z.ZodString;
    result: z.ZodLiteral<"passed">;
    report_url: z.ZodURL;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"thread_resolution">;
    thread_id: z.ZodString;
    author_id: z.ZodNumber;
}, z.core.$strict>], "kind">;
export declare const DecisionAnswerSchema: z.ZodObject<{
    comment_id: z.ZodNumber;
    author_id: z.ZodNumber;
    option_id: z.ZodString;
}, z.core.$strict>;
export declare const PriorFindingSchema: z.ZodUnion<readonly [z.ZodObject<{
    status: z.ZodLiteral<"resolved">;
    evidence: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"github_comment">;
        comment_id: z.ZodNumber;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"code">;
        commit_sha: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"commit">;
        sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"check_run">;
        check_run_id: z.ZodNumber;
        commit_sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"document">;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"verification">;
        commit_sha: z.ZodString;
        command: z.ZodString;
        result: z.ZodLiteral<"passed">;
        report_url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"thread_resolution">;
        thread_id: z.ZodString;
        author_id: z.ZodNumber;
    }, z.core.$strict>], "kind">>;
    id: z.ZodString;
    reason: z.ZodString;
    reply: z.ZodOptional<z.ZodString>;
    decision: z.ZodOptional<z.ZodObject<{
        comment_id: z.ZodNumber;
        author_id: z.ZodNumber;
        option_id: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"withdrawn">;
    evidence: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"github_comment">;
        comment_id: z.ZodNumber;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"code">;
        commit_sha: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"commit">;
        sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"check_run">;
        check_run_id: z.ZodNumber;
        commit_sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"document">;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"verification">;
        commit_sha: z.ZodString;
        command: z.ZodString;
        result: z.ZodLiteral<"passed">;
        report_url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"thread_resolution">;
        thread_id: z.ZodString;
        author_id: z.ZodNumber;
    }, z.core.$strict>], "kind">>;
    withdrawal_basis: z.ZodEnum<{
        dismissed: "dismissed";
        incorrect: "incorrect";
        no_longer_applicable: "no_longer_applicable";
    }>;
    id: z.ZodString;
    reason: z.ZodString;
    reply: z.ZodOptional<z.ZodString>;
    decision: z.ZodOptional<z.ZodObject<{
        comment_id: z.ZodNumber;
        author_id: z.ZodNumber;
        option_id: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"still_open">;
    evidence: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"github_comment">;
        comment_id: z.ZodNumber;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"code">;
        commit_sha: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"commit">;
        sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"check_run">;
        check_run_id: z.ZodNumber;
        commit_sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"document">;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"verification">;
        commit_sha: z.ZodString;
        command: z.ZodString;
        result: z.ZodLiteral<"passed">;
        report_url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"thread_resolution">;
        thread_id: z.ZodString;
        author_id: z.ZodNumber;
    }, z.core.$strict>], "kind">>>;
    updated_finding: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        id: z.ZodString;
        label: z.ZodEnum<{
            chore: "chore";
            question: "question";
            issue: "issue";
            todo: "todo";
            suggestion: "suggestion";
            nitpick: "nitpick";
            typo: "typo";
            polish: "polish";
        }>;
        type: z.ZodEnum<{
            fix: "fix";
            clarify: "clarify";
        }>;
        blocking: z.ZodBoolean;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            trivial: "trivial";
        }>;
        details: z.ZodString;
        resolved_when: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"decide">;
        decision_owner: z.ZodString;
        decision_options: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
        }, z.core.$strict>>;
        label: z.ZodEnum<{
            chore: "chore";
            question: "question";
            issue: "issue";
            todo: "todo";
            suggestion: "suggestion";
            nitpick: "nitpick";
            typo: "typo";
            polish: "polish";
        }>;
        blocking: z.ZodBoolean;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            trivial: "trivial";
        }>;
        details: z.ZodString;
        resolved_when: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>;
    id: z.ZodString;
    reason: z.ZodString;
    reply: z.ZodOptional<z.ZodString>;
    decision: z.ZodOptional<z.ZodObject<{
        comment_id: z.ZodNumber;
        author_id: z.ZodNumber;
        option_id: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>]>;
export declare const ReviewSchema: z.ZodObject<{
    findings: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        label: z.ZodEnum<{
            chore: "chore";
            question: "question";
            issue: "issue";
            todo: "todo";
            suggestion: "suggestion";
            nitpick: "nitpick";
            typo: "typo";
            polish: "polish";
        }>;
        type: z.ZodEnum<{
            fix: "fix";
            clarify: "clarify";
        }>;
        blocking: z.ZodBoolean;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            trivial: "trivial";
        }>;
        details: z.ZodString;
        resolved_when: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"decide">;
        decision_owner: z.ZodString;
        decision_options: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
        }, z.core.$strict>>;
        label: z.ZodEnum<{
            chore: "chore";
            question: "question";
            issue: "issue";
            todo: "todo";
            suggestion: "suggestion";
            nitpick: "nitpick";
            typo: "typo";
            polish: "polish";
        }>;
        blocking: z.ZodBoolean;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            trivial: "trivial";
        }>;
        details: z.ZodString;
        resolved_when: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        label: z.ZodEnum<{
            note: "note";
            praise: "praise";
            thought: "thought";
        }>;
        blocking: z.ZodLiteral<false>;
        details: z.ZodOptional<z.ZodString>;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>;
    prior_findings: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        status: z.ZodLiteral<"resolved">;
        evidence: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"github_comment">;
            comment_id: z.ZodNumber;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"code">;
            commit_sha: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"commit">;
            sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"check_run">;
            check_run_id: z.ZodNumber;
            commit_sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"document">;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"verification">;
            commit_sha: z.ZodString;
            command: z.ZodString;
            result: z.ZodLiteral<"passed">;
            report_url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"thread_resolution">;
            thread_id: z.ZodString;
            author_id: z.ZodNumber;
        }, z.core.$strict>], "kind">>;
        id: z.ZodString;
        reason: z.ZodString;
        reply: z.ZodOptional<z.ZodString>;
        decision: z.ZodOptional<z.ZodObject<{
            comment_id: z.ZodNumber;
            author_id: z.ZodNumber;
            option_id: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodLiteral<"withdrawn">;
        evidence: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"github_comment">;
            comment_id: z.ZodNumber;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"code">;
            commit_sha: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"commit">;
            sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"check_run">;
            check_run_id: z.ZodNumber;
            commit_sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"document">;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"verification">;
            commit_sha: z.ZodString;
            command: z.ZodString;
            result: z.ZodLiteral<"passed">;
            report_url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"thread_resolution">;
            thread_id: z.ZodString;
            author_id: z.ZodNumber;
        }, z.core.$strict>], "kind">>;
        withdrawal_basis: z.ZodEnum<{
            dismissed: "dismissed";
            incorrect: "incorrect";
            no_longer_applicable: "no_longer_applicable";
        }>;
        id: z.ZodString;
        reason: z.ZodString;
        reply: z.ZodOptional<z.ZodString>;
        decision: z.ZodOptional<z.ZodObject<{
            comment_id: z.ZodNumber;
            author_id: z.ZodNumber;
            option_id: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodLiteral<"still_open">;
        evidence: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"github_comment">;
            comment_id: z.ZodNumber;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"code">;
            commit_sha: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"commit">;
            sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"check_run">;
            check_run_id: z.ZodNumber;
            commit_sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"document">;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"verification">;
            commit_sha: z.ZodString;
            command: z.ZodString;
            result: z.ZodLiteral<"passed">;
            report_url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"thread_resolution">;
            thread_id: z.ZodString;
            author_id: z.ZodNumber;
        }, z.core.$strict>], "kind">>>;
        updated_finding: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            id: z.ZodString;
            label: z.ZodEnum<{
                chore: "chore";
                question: "question";
                issue: "issue";
                todo: "todo";
                suggestion: "suggestion";
                nitpick: "nitpick";
                typo: "typo";
                polish: "polish";
            }>;
            type: z.ZodEnum<{
                fix: "fix";
                clarify: "clarify";
            }>;
            blocking: z.ZodBoolean;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
                trivial: "trivial";
            }>;
            details: z.ZodString;
            resolved_when: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
            start_line: z.ZodOptional<z.ZodNumber>;
            category: z.ZodOptional<z.ZodEnum<{
                docs: "docs";
                data: "data";
                deployment: "deployment";
                security: "security";
                correctness: "correctness";
                design: "design";
                testing: "testing";
                performance: "performance";
                readability: "readability";
            }>>;
            subject: z.ZodString;
            discussion: z.ZodString;
            related_finding_id: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"decide">;
            decision_owner: z.ZodString;
            decision_options: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                description: z.ZodString;
            }, z.core.$strict>>;
            label: z.ZodEnum<{
                chore: "chore";
                question: "question";
                issue: "issue";
                todo: "todo";
                suggestion: "suggestion";
                nitpick: "nitpick";
                typo: "typo";
                polish: "polish";
            }>;
            blocking: z.ZodBoolean;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
                trivial: "trivial";
            }>;
            details: z.ZodString;
            resolved_when: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
            start_line: z.ZodOptional<z.ZodNumber>;
            category: z.ZodOptional<z.ZodEnum<{
                docs: "docs";
                data: "data";
                deployment: "deployment";
                security: "security";
                correctness: "correctness";
                design: "design";
                testing: "testing";
                performance: "performance";
                readability: "readability";
            }>>;
            subject: z.ZodString;
            discussion: z.ZodString;
            related_finding_id: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>>;
        id: z.ZodString;
        reason: z.ZodString;
        reply: z.ZodOptional<z.ZodString>;
        decision: z.ZodOptional<z.ZodObject<{
            comment_id: z.ZodNumber;
            author_id: z.ZodNumber;
            option_id: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>]>>;
    contract_version: z.ZodLiteral<1>;
    schema_revision: z.ZodLiteral<1>;
    head_sha: z.ZodString;
    review_complete: z.ZodBoolean;
    incomplete_reason: z.ZodOptional<z.ZodString>;
    summary: z.ZodString;
    outcome: z.ZodEnum<{
        APPROVED: "APPROVED";
        CHANGES_NEEDED: "CHANGES_NEEDED";
        ESCALATE: "ESCALATE";
        INCOMPLETE: "INCOMPLETE";
    }>;
    outcome_reason: z.ZodString;
    remaining_risk: z.ZodString;
    extensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$strict>;
export declare const FindingRecordSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    schema_revision: z.ZodLiteral<1>;
    finding: z.ZodUnion<readonly [z.ZodObject<{
        id: z.ZodString;
        label: z.ZodEnum<{
            chore: "chore";
            question: "question";
            issue: "issue";
            todo: "todo";
            suggestion: "suggestion";
            nitpick: "nitpick";
            typo: "typo";
            polish: "polish";
        }>;
        type: z.ZodEnum<{
            fix: "fix";
            clarify: "clarify";
        }>;
        blocking: z.ZodBoolean;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            trivial: "trivial";
        }>;
        details: z.ZodString;
        resolved_when: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"decide">;
        decision_owner: z.ZodString;
        decision_options: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
        }, z.core.$strict>>;
        label: z.ZodEnum<{
            chore: "chore";
            question: "question";
            issue: "issue";
            todo: "todo";
            suggestion: "suggestion";
            nitpick: "nitpick";
            typo: "typo";
            polish: "polish";
        }>;
        blocking: z.ZodBoolean;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            trivial: "trivial";
        }>;
        details: z.ZodString;
        resolved_when: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>;
    status: z.ZodEnum<{
        open: "open";
        resolved: "resolved";
        withdrawn: "withdrawn";
    }>;
    evidence: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"github_comment">;
        comment_id: z.ZodNumber;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"code">;
        commit_sha: z.ZodString;
        path: z.ZodString;
        line: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"commit">;
        sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"check_run">;
        check_run_id: z.ZodNumber;
        commit_sha: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"document">;
        url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"verification">;
        commit_sha: z.ZodString;
        command: z.ZodString;
        result: z.ZodLiteral<"passed">;
        report_url: z.ZodURL;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"thread_resolution">;
        thread_id: z.ZodString;
        author_id: z.ZodNumber;
    }, z.core.$strict>], "kind">>;
    decision: z.ZodOptional<z.ZodObject<{
        comment_id: z.ZodNumber;
        author_id: z.ZodNumber;
        option_id: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ReviewStateSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    schema_revision: z.ZodLiteral<1>;
    sha: z.ZodString;
    outcome: z.ZodEnum<{
        APPROVED: "APPROVED";
        CHANGES_NEEDED: "CHANGES_NEEDED";
        ESCALATE: "ESCALATE";
        INCOMPLETE: "INCOMPLETE";
    }>;
    records: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        id: z.ZodString;
        status: z.ZodEnum<{
            open: "open";
            resolved: "resolved";
            withdrawn: "withdrawn";
        }>;
        location: z.ZodUnion<readonly [z.ZodObject<{
            kind: z.ZodLiteral<"review_comment">;
            comment_id: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"review_body">;
            review_id: z.ZodNumber;
        }, z.core.$strict>]>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        status: z.ZodLiteral<"informational">;
        fingerprint: z.ZodString;
        finding: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodEnum<{
                note: "note";
                praise: "praise";
                thought: "thought";
            }>;
            blocking: z.ZodLiteral<false>;
            details: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
            line: z.ZodNumber;
            start_line: z.ZodOptional<z.ZodNumber>;
            category: z.ZodOptional<z.ZodEnum<{
                docs: "docs";
                data: "data";
                deployment: "deployment";
                security: "security";
                correctness: "correctness";
                design: "design";
                testing: "testing";
                performance: "performance";
                readability: "readability";
            }>>;
            subject: z.ZodString;
            discussion: z.ZodString;
            related_finding_id: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
/** A model-facing superset; the full schema and planner validate variants before any writes. */
export declare const TransportReviewSchema: z.ZodObject<{
    findings: z.ZodArray<z.ZodObject<{
        type: z.ZodOptional<z.ZodEnum<{
            fix: "fix";
            clarify: "clarify";
            decide: "decide";
        }>>;
        label: z.ZodEnum<{
            chore: "chore";
            question: "question";
            issue: "issue";
            note: "note";
            todo: "todo";
            suggestion: "suggestion";
            nitpick: "nitpick";
            typo: "typo";
            polish: "polish";
            praise: "praise";
            thought: "thought";
        }>;
        severity: z.ZodOptional<z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            trivial: "trivial";
        }>>;
        details: z.ZodOptional<z.ZodString>;
        resolved_when: z.ZodOptional<z.ZodString>;
        decision_owner: z.ZodOptional<z.ZodString>;
        decision_options: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
        }, z.core.$strict>>>;
        blocking: z.ZodBoolean;
        path: z.ZodString;
        line: z.ZodNumber;
        start_line: z.ZodOptional<z.ZodNumber>;
        category: z.ZodOptional<z.ZodEnum<{
            docs: "docs";
            data: "data";
            deployment: "deployment";
            security: "security";
            correctness: "correctness";
            design: "design";
            testing: "testing";
            performance: "performance";
            readability: "readability";
        }>>;
        subject: z.ZodString;
        discussion: z.ZodString;
        related_finding_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    prior_findings: z.ZodArray<z.ZodObject<{
        status: z.ZodEnum<{
            resolved: "resolved";
            withdrawn: "withdrawn";
            still_open: "still_open";
        }>;
        evidence: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"github_comment">;
            comment_id: z.ZodNumber;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"code">;
            commit_sha: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"commit">;
            sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"check_run">;
            check_run_id: z.ZodNumber;
            commit_sha: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"document">;
            url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"verification">;
            commit_sha: z.ZodString;
            command: z.ZodString;
            result: z.ZodLiteral<"passed">;
            report_url: z.ZodURL;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"thread_resolution">;
            thread_id: z.ZodString;
            author_id: z.ZodNumber;
        }, z.core.$strict>], "kind">>>;
        withdrawal_basis: z.ZodOptional<z.ZodEnum<{
            dismissed: "dismissed";
            incorrect: "incorrect";
            no_longer_applicable: "no_longer_applicable";
        }>>;
        updated_finding: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            id: z.ZodString;
            label: z.ZodEnum<{
                chore: "chore";
                question: "question";
                issue: "issue";
                todo: "todo";
                suggestion: "suggestion";
                nitpick: "nitpick";
                typo: "typo";
                polish: "polish";
            }>;
            type: z.ZodEnum<{
                fix: "fix";
                clarify: "clarify";
            }>;
            blocking: z.ZodBoolean;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
                trivial: "trivial";
            }>;
            details: z.ZodString;
            resolved_when: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
            start_line: z.ZodOptional<z.ZodNumber>;
            category: z.ZodOptional<z.ZodEnum<{
                docs: "docs";
                data: "data";
                deployment: "deployment";
                security: "security";
                correctness: "correctness";
                design: "design";
                testing: "testing";
                performance: "performance";
                readability: "readability";
            }>>;
            subject: z.ZodString;
            discussion: z.ZodString;
            related_finding_id: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"decide">;
            decision_owner: z.ZodString;
            decision_options: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                description: z.ZodString;
            }, z.core.$strict>>;
            label: z.ZodEnum<{
                chore: "chore";
                question: "question";
                issue: "issue";
                todo: "todo";
                suggestion: "suggestion";
                nitpick: "nitpick";
                typo: "typo";
                polish: "polish";
            }>;
            blocking: z.ZodBoolean;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
                trivial: "trivial";
            }>;
            details: z.ZodString;
            resolved_when: z.ZodString;
            path: z.ZodString;
            line: z.ZodNumber;
            start_line: z.ZodOptional<z.ZodNumber>;
            category: z.ZodOptional<z.ZodEnum<{
                docs: "docs";
                data: "data";
                deployment: "deployment";
                security: "security";
                correctness: "correctness";
                design: "design";
                testing: "testing";
                performance: "performance";
                readability: "readability";
            }>>;
            subject: z.ZodString;
            discussion: z.ZodString;
            related_finding_id: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            label: z.ZodEnum<{
                note: "note";
                praise: "praise";
                thought: "thought";
            }>;
            blocking: z.ZodLiteral<false>;
            details: z.ZodOptional<z.ZodString>;
            path: z.ZodString;
            line: z.ZodNumber;
            start_line: z.ZodOptional<z.ZodNumber>;
            category: z.ZodOptional<z.ZodEnum<{
                docs: "docs";
                data: "data";
                deployment: "deployment";
                security: "security";
                correctness: "correctness";
                design: "design";
                testing: "testing";
                performance: "performance";
                readability: "readability";
            }>>;
            subject: z.ZodString;
            discussion: z.ZodString;
            related_finding_id: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>>;
        id: z.ZodString;
        reason: z.ZodString;
        reply: z.ZodOptional<z.ZodString>;
        decision: z.ZodOptional<z.ZodObject<{
            comment_id: z.ZodNumber;
            author_id: z.ZodNumber;
            option_id: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    contract_version: z.ZodLiteral<1>;
    schema_revision: z.ZodLiteral<1>;
    head_sha: z.ZodString;
    review_complete: z.ZodBoolean;
    incomplete_reason: z.ZodOptional<z.ZodString>;
    summary: z.ZodString;
    outcome: z.ZodEnum<{
        APPROVED: "APPROVED";
        CHANGES_NEEDED: "CHANGES_NEEDED";
        ESCALATE: "ESCALATE";
        INCOMPLETE: "INCOMPLETE";
    }>;
    outcome_reason: z.ZodString;
    remaining_risk: z.ZodString;
    extensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$strict>;
export type Review = z.infer<typeof ReviewSchema>;
export type NewFinding = z.infer<typeof NewFindingSchema>;
export type ActionableFinding = z.infer<typeof ActionableFindingSchema>;
export type StoredFinding = z.infer<typeof StoredFindingSchema>;
export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;
export type FindingRecord = z.infer<typeof FindingRecordSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;
export type PriorFinding = z.infer<typeof PriorFindingSchema>;
