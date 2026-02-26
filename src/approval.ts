import { createId, ensure } from "./errors";
import { GateDecision, HumanApprovalRequest, ResumeToken } from "./types";

interface ApprovalRecord {
  request: HumanApprovalRequest;
  comment?: string;
}

interface TokenRecord {
  token: ResumeToken;
  approvalId: string;
  decision: "approve" | "deny";
}

export class ApprovalController {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly ttlSec: number;

  public constructor(ttlSec = 900) {
    this.ttlSec = ttlSec;
  }

  public async createApprovalRequest(
    runId: string,
    gateDecision: GateDecision,
    prompt: string
  ): Promise<HumanApprovalRequest> {
    ensure(runId, "AGENTS-E-APPROVAL-INVALID", "runId is required.");
    ensure(
      gateDecision.decision === "needs_human",
      "AGENTS-E-APPROVAL-INVALID",
      "createApprovalRequest requires decision=needs_human."
    );

    const approval: HumanApprovalRequest = {
      approval_id: gateDecision.approval_id ?? createId("approval"),
      run_id: runId,
      required_action: "human_review",
      prompt,
      status: "pending"
    };
    this.approvals.set(approval.approval_id, { request: approval });
    return approval;
  }

  public async getPendingApprovals(runId?: string): Promise<HumanApprovalRequest[]> {
    const items = [...this.approvals.values()]
      .map((record) => record.request)
      .filter((request) => request.status === "pending");

    if (!runId) {
      return items;
    }
    return items.filter((item) => item.run_id === runId);
  }

  public async submitApproval(
    approvalId: string,
    decision: "approve" | "deny",
    comment?: string
  ): Promise<ResumeToken> {
    const record = this.approvals.get(approvalId);
    ensure(record, "AGENTS-E-APPROVAL-NOT-FOUND", `Approval not found: ${approvalId}`);
    ensure(
      record.request.status === "pending",
      "AGENTS-E-APPROVAL-INVALID",
      `Approval is not pending: ${approvalId}`
    );

    record.request.status = decision === "approve" ? "approved" : "denied";
    record.comment = comment;

    const expiresAt = new Date(Date.now() + this.ttlSec * 1000).toISOString();
    const token: ResumeToken = {
      token: createId("resume"),
      run_id: record.request.run_id,
      expires_at: expiresAt,
      status: "active"
    };
    this.tokens.set(token.token, {
      token,
      approvalId,
      decision
    });
    return token;
  }

  public consumeResumeToken(
    runId: string,
    tokenValue: string
  ): { decision: "approve" | "deny"; approvalId: string } {
    const tokenRecord = this.tokens.get(tokenValue);
    ensure(tokenRecord, "AGENTS-E-RESUME-TOKEN", "Resume token is not found.");
    ensure(tokenRecord.token.run_id === runId, "AGENTS-E-RESUME-TOKEN", "runId mismatch.");
    ensure(tokenRecord.token.status === "active", "AGENTS-E-RESUME-TOKEN", "Token is not active.");
    ensure(
      new Date(tokenRecord.token.expires_at).getTime() > Date.now(),
      "AGENTS-E-RESUME-TOKEN",
      "Token has expired."
    );

    tokenRecord.token.status = "used";
    return {
      decision: tokenRecord.decision,
      approvalId: tokenRecord.approvalId
    };
  }
}
